package main

import (
	"encoding/json"
	"fmt"
	"net/netip"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const candidateLimit = 5000

type candidate struct {
	Node          Node   `json:"node"`
	LastAttemptAt string `json:"lastAttemptAt,omitempty"`
	Confirmed     bool   `json:"confirmed"`
}

// Pending order survives scan budgets and restarts. New referrals append once;
// completed endpoints are not scheduled again until the whole pass drains.
type frontier struct {
	Candidates      map[string]candidate `json:"candidates"`
	Pending         []string             `json:"pending"`
	CompletedPasses int                  `json:"completedPasses"`
	Capped          bool                 `json:"capped"`
}

func newFrontier() *frontier {
	return &frontier{Candidates: map[string]candidate{}, Pending: []string{}}
}

func candidateKey(n Node) string {
	ip, err := netip.ParseAddr(n.IP)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%s@%s:%d/%d", n.ID, ip.Unmap().String(), n.TCP, n.UDP)
}

func (f *frontier) observe(n Node) bool {
	if !publicIP(n.IP) || !validID(n.ID) || n.TCP < 1024 || n.UDP < 1024 {
		return false
	}
	key := candidateKey(n)
	if old, exists := f.Candidates[key]; exists {
		old.Node.LastSeen = n.LastSeen
		f.Candidates[key] = old
		return false
	}
	if len(f.Candidates) >= candidateLimit {
		f.Capped = true
		return false
	}
	f.Candidates[key] = candidate{Node: n}
	f.Pending = append(f.Pending, key)
	return true
}

func (f *frontier) beginPass() {
	if len(f.Pending) != 0 {
		return
	}
	f.Capped = false
	for key, c := range f.Candidates {
		seen, err := time.Parse(time.RFC3339, c.Node.LastSeen)
		if err != nil || time.Since(seen) > 24*time.Hour {
			delete(f.Candidates, key)
			continue
		}
		f.Pending = append(f.Pending, key)
	}
	sort.Slice(f.Pending, func(i, j int) bool {
		a, b := f.Candidates[f.Pending[i]], f.Candidates[f.Pending[j]]
		if a.LastAttemptAt != b.LastAttemptAt {
			return a.LastAttemptAt < b.LastAttemptAt
		}
		return f.Pending[i] < f.Pending[j]
	})
}

func (f *frontier) take(count int) []Node {
	count = min(count, len(f.Pending))
	nodes := make([]Node, 0, count)
	for _, key := range f.Pending[:count] {
		nodes = append(nodes, f.Candidates[key].Node)
	}
	f.Pending = f.Pending[count:]
	return nodes
}

func (f *frontier) finish(n Node, confirmed bool, stamp string) {
	key := candidateKey(n)
	c := f.Candidates[key]
	c.LastAttemptAt, c.Confirmed = stamp, confirmed
	if confirmed {
		c.Node.LastSeen = stamp
	}
	f.Candidates[key] = c
}

func (f *frontier) retryInterrupted(n Node) {
	key := candidateKey(n)
	for _, pending := range f.Pending {
		if pending == key {
			return
		}
	}
	f.Pending = append([]string{key}, f.Pending...)
}

func (f *frontier) progress() *CrawlProgress {
	p := &CrawlProgress{Candidates: len(f.Candidates), Pending: len(f.Pending), CompletedPasses: f.CompletedPasses, Capped: f.Capped}
	ips, confirmedIPs := map[string]bool{}, map[string]bool{}
	for _, c := range f.Candidates {
		ip, _ := netip.ParseAddr(c.Node.IP)
		ips[ip.Unmap().String()] = true
		if c.LastAttemptAt != "" {
			p.Attempted++
		}
		if c.Confirmed {
			p.Confirmed++
			confirmedIPs[ip.Unmap().String()] = true
		}
	}
	p.UniqueIPs, p.ConfirmedIPs = len(ips), len(confirmedIPs)
	return p
}

func writeJSONAtomic(path string, value any) error {
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err = os.WriteFile(path+".tmp", body, 0600); err != nil {
		return err
	}
	return os.Rename(path+".tmp", path)
}

func (f *frontier) save(dir string) error {
	return writeJSONAtomic(filepath.Join(dir, "crawl.json"), f)
}

func loadFrontier(dir string) (*frontier, error) {
	f := newFrontier()
	body, err := os.ReadFile(filepath.Join(dir, "crawl.json"))
	if os.IsNotExist(err) {
		return f, nil
	}
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(body, f); err != nil {
		return nil, err
	}
	if len(f.Candidates) > candidateLimit || len(f.Pending) > candidateLimit {
		return nil, fmt.Errorf("saved crawl exceeds candidate limit")
	}
	if f.Candidates == nil {
		f.Candidates = map[string]candidate{}
	}
	for key, c := range f.Candidates {
		if key != candidateKey(c.Node) || !publicIP(c.Node.IP) || !validID(c.Node.ID) || c.Node.TCP < 1024 || c.Node.UDP < 1024 {
			delete(f.Candidates, key)
		}
	}
	pending := []string{}
	seen := map[string]bool{}
	for _, key := range f.Pending {
		if _, exists := f.Candidates[key]; exists && !seen[key] {
			pending = append(pending, key)
			seen[key] = true
		}
	}
	f.Pending = pending
	return f, nil
}
