package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
	log15 "github.com/inconshreveable/log15"
	"github.com/zenon-network/go-zenon/p2p"
	"github.com/zenon-network/go-zenon/p2p/discover"
)

type config struct {
	seeds            []string
	origins          map[string]bool
	dir, port        string
	interval, budget time.Duration
	max, workers     int
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func duration(key, fallback string, min, max time.Duration) time.Duration {
	d, e := time.ParseDuration(env(key, fallback))
	if e != nil || d < min || d > max {
		log.Fatalf("invalid %s", key)
	}
	return d
}
func number(key, fallback string, min, max int) int {
	n, e := strconv.Atoi(env(key, fallback))
	if e != nil || n < min || n > max {
		log.Fatalf("invalid %s", key)
	}
	return n
}
func loadConfig() config {
	origins := map[string]bool{}
	for _, s := range strings.Split(env("ALLOWED_ORIGINS", "https://0x3639.github.io"), ",") {
		origins[strings.TrimSpace(s)] = true
	}
	seeds := strings.Split(env("SEED_URLS", "wss://my.hc1node.com:35998,wss://node.zenonhub.io:35998,wss://node.atsocy.com:35998"), ",")
	if len(seeds) > 8 {
		log.Fatal("at most 8 seeds are supported")
	}
	for i := range seeds {
		seeds[i] = strings.TrimSpace(seeds[i])
	}
	return config{seeds, origins, env("DATA_DIR", "/data"), env("PORT", "8080"), duration("SCAN_INTERVAL", "10m", time.Minute, 24*time.Hour), duration("SCAN_BUDGET", "3m", 10*time.Second, 10*time.Minute), number("MAX_NODES", "256", 1, 1000), number("CONCURRENCY", "4", 1, 8)}
}

type store struct {
	mu          sync.RWMutex
	snapshot    Snapshot
	body, nodes []byte
	etag        string
}

func (s *store) publish(snapshot Snapshot) {
	body, _ := json.Marshal(snapshot)
	nodes, _ := json.Marshal(struct {
		GeneratedAt string `json:"generatedAt"`
		Nodes       []Node `json:"nodes"`
	}{snapshot.GeneratedAt, snapshot.Nodes})
	etag := fmt.Sprintf(`"%x"`, sha256.Sum256(body))
	s.mu.Lock()
	s.snapshot = snapshot
	s.body = body
	s.nodes = nodes
	s.etag = etag
	s.mu.Unlock()
}
func (s *store) current() Snapshot { s.mu.RLock(); defer s.mu.RUnlock(); return s.snapshot }
func handler(data *store, origins map[string]bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Vary", "Origin")
		if origin := r.Header.Get("Origin"); origins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "If-None-Match")
			w.Header().Set("Access-Control-Expose-Headers", "ETag")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD, OPTIONS")
			http.Error(w, "read-only API", 405)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		data.mu.RLock()
		defer data.mu.RUnlock()
		if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
			w.Header().Set("Cache-Control", "no-store")
			if r.URL.Path == "/readyz" && len(data.snapshot.Nodes) == 0 {
				w.WriteHeader(503)
			}
			if r.Method != http.MethodHead {
				json.NewEncoder(w).Encode(map[string]any{"status": "ok", "scanning": data.snapshot.Scanning, "nodes": len(data.snapshot.Nodes), "updatedAt": data.snapshot.GeneratedAt})
			}
			return
		}
		if r.URL.Path != "/api/v1/network" && r.URL.Path != "/api/v1/nodes" {
			http.Error(w, `{"error":"not found"}`, 404)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=30")
		w.Header().Set("ETag", data.etag)
		if r.Header.Get("If-None-Match") == data.etag {
			w.WriteHeader(304)
			return
		}
		if len(data.snapshot.Nodes) == 0 {
			w.Header().Set("Retry-After", "15")
			w.WriteHeader(503)
		}
		if r.Method == http.MethodHead {
			return
		}
		if r.URL.Path == "/api/v1/nodes" {
			w.Write(data.nodes)
		} else {
			w.Write(data.body)
		}
	})
}

func mergeNode(nodes map[string]Node, n Node) {
	old, ok := nodes[n.ID]
	if !ok {
		if len(nodes) < 5000 {
			nodes[n.ID] = n
		}
		return
	}
	old.Sources = uniqueAll(old.Sources, n.Sources)
	old.RPCEndpoints = uniqueAll(old.RPCEndpoints, n.RPCEndpoints)
	old.ReportedVersions = uniqueAll(old.ReportedVersions, n.ReportedVersions)
	// A referral does not make an older direct version observation fresh.
	if n.Evidence == "discovery" && old.Version != nil {
		nodes[n.ID] = old
		return
	}
	if n.Evidence != "discovery" {
		old.Version = n.Version
		old.Name = n.Name
		old.Evidence = n.Evidence
		old.Commit = n.Commit
	}
	if publicIP(n.IP) {
		old.IP = n.IP
	}
	if n.TCP != 0 {
		old.TCP = n.TCP
	}
	if n.UDP != 0 {
		old.UDP = n.UDP
	}
	old.LastSeen = n.LastSeen
	nodes[n.ID] = old
}
func uniqueAll(a, b []string) []string {
	for _, v := range b {
		a = unique(a, v)
	}
	return a
}

type probeResult struct {
	node           Node
	neighbors      []Node
	udpErr, tcpErr error
	name           string
}

func runScan(ctx context.Context, c config, key *ecdsa.PrivateKey, data *store) {
	ctx, cancel := context.WithTimeout(ctx, c.budget)
	defer cancel()
	old := data.current()
	nodes := map[string]Node{}
	sources := []Source{}
	started := now()
	limited := false
	release := old.Release
	pillarCount, pillarChecked := old.PillarCount, old.PillarCountCheckedAt
	for _, n := range old.Nodes {
		if t, e := time.Parse(time.RFC3339, n.LastSeen); e == nil && time.Since(t) < 24*time.Hour {
			nodes[n.ID] = n
		}
	}
	publish := func(scanning bool) {
		list := make([]Node, 0, len(nodes))
		for _, n := range nodes {
			list = append(list, n)
		}
		sort.Slice(list, func(i, j int) bool { return list[i].ID < list[j].ID })
		data.publish(Snapshot{SchemaVersion: 1, StartedAt: started, GeneratedAt: now(), Mode: "discovery", Nodes: list, Sources: append([]Source{}, sources...), Limited: limited, Release: release, Scanning: scanning, PillarCount: pillarCount, PillarCountCheckedAt: pillarChecked})
	}
	publish(true)
	for _, seed := range c.seeds {
		if ctx.Err() != nil {
			break
		}
		observed, source := readSeed(ctx, seed)
		sources = append(sources, source)
		for _, n := range observed {
			mergeNode(nodes, n)
		}
		publish(true)
	}
	for _, source := range sources {
		if source.Status == "ok" {
			var result struct {
				Count int `json:"count"`
			}
			if seedRPC(ctx, source.Endpoint, "embedded.pillar.getAll", &result, 0, 1) == nil && result.Count > 0 {
				pillarCount = &result.Count
				pillarChecked = now()
			}
			break
		}
	}
	if release == nil {
		release = latestRelease(ctx)
	} else if checked, e := time.Parse(time.RFC3339, release.CheckedAt); e != nil || time.Since(checked) > 24*time.Hour {
		if r := latestRelease(ctx); r != nil {
			release = r
		}
	}
	publish(true)
	queue := []Node{}
	queued := map[string]bool{}
	enqueue := func(n Node) {
		if !queued[n.ID] && publicIP(n.IP) && validID(n.ID) {
			queued[n.ID] = true
			queue = append(queue, n)
		}
	}
	// Rotate previously seen nodes so a scan budget never permanently starves the same tail.
	for _, n := range nodes {
		enqueue(n)
	}
	// Rotate the upstream bootstrap set as well as the observed peer queue.
	seedOffset := int(time.Now().Unix()/int64(c.interval.Seconds())) % len(p2p.DefaultSeeders)
	for i := 0; i < min(24, len(p2p.DefaultSeeders)); i++ {
		raw := p2p.DefaultSeeders[(seedOffset+i)%len(p2p.DefaultSeeders)]
		if n, e := discover.ParseNode(raw); e == nil {
			candidate := newNode(n.ID.String(), n.IP.String(), "", "bootstrap", "discovery")
			candidate.TCP = n.TCP
			candidate.UDP = n.UDP
			enqueue(candidate)
		}
	}
	checked := 0
	for len(queue) > 0 && checked < c.max && ctx.Err() == nil {
		size := min(c.workers, len(queue), c.max-checked)
		batch := queue[:size]
		queue = queue[size:]
		checked += size
		results := make(chan probeResult, size)
		for _, candidate := range batch {
			go func(n Node) {
				neighbors, udpErr := discoverNeighbors(ctx, key, n)
				name, tcpErr := probeVersion(ctx, key, n)
				results <- probeResult{n, neighbors, udpErr, tcpErr, name}
			}(candidate)
		}
		for range size {
			r := <-results
			endpoint := "enode://" + r.node.ID + "@" + netAddress(r.node)
			source := Source{Endpoint: endpoint, Status: "error", PeerCount: len(r.neighbors), CheckedAt: now()}
			if r.tcpErr == nil {
				n := newNode(r.node.ID, r.node.IP, r.name, endpoint, "p2p")
				n.TCP = r.node.TCP
				n.UDP = r.node.UDP
				mergeNode(nodes, n)
				source.Status = "ok"
				source.NodeID = &n.ID
			} else {
				source.Error = bounded(r.tcpErr.Error(), 200)
			}
			// Report discovery success separately from the version handshake.
			if r.udpErr == nil {
				sources = append(sources, Source{Endpoint: "discovery://" + netAddress(r.node), Status: "ok", PeerCount: len(r.neighbors), NodeID: &r.node.ID, CheckedAt: now()})
			}
			sources = append(sources, source)
			for _, neighbor := range r.neighbors {
				mergeNode(nodes, neighbor)
				if len(queued) < c.max*4 {
					enqueue(neighbor)
				} else {
					limited = true
				}
			}
		}
		publish(true)
	}
	limited = limited || len(queue) > 0 || ctx.Err() != nil
	publish(false)
	snapshot := data.current()
	if len(snapshot.Nodes) > 0 {
		body, _ := json.MarshalIndent(snapshot, "", "  ")
		temp := filepath.Join(c.dir, "network.json.tmp")
		if e := os.WriteFile(temp, body, 0600); e == nil {
			if e = os.Rename(temp, filepath.Join(c.dir, "network.json")); e != nil {
				log.Printf("snapshot save: %v", e)
			}
		} else {
			log.Printf("snapshot save: %v", e)
		}
	}
	log.Printf("scan complete: %d nodes, %d peers probed, limited=%v", len(nodes), checked, limited)
}
func netAddress(n Node) string {
	host := n.IP
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	return host + ":" + strconv.Itoa(int(n.TCP))
}

func main() {
	c := loadConfig()
	if err := os.MkdirAll(c.dir, 0700); err != nil {
		log.Fatal(err)
	}
	log15.Root().SetHandler(log15.DiscardHandler())
	keyPath := filepath.Join(c.dir, "identity.key")
	key, err := crypto.LoadECDSA(keyPath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Fatal("cannot read identity: ", err)
		}
		key, err = crypto.GenerateKey()
		if err != nil {
			log.Fatal(err)
		}
		if err = crypto.SaveECDSA(keyPath, key); err != nil {
			log.Fatal(err)
		}
	}
	data := &store{}
	initial := Snapshot{SchemaVersion: 1, StartedAt: now(), GeneratedAt: now(), Mode: "discovery", Nodes: []Node{}, Sources: []Source{}}
	if raw, e := os.ReadFile(filepath.Join(c.dir, "network.json")); e == nil {
		var saved Snapshot
		if json.Unmarshal(raw, &saved) == nil && saved.SchemaVersion == 1 && len(saved.Nodes) <= 5000 {
			initial = saved
			initial.Scanning = false
		}
	}
	data.publish(initial)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			runScan(ctx, c, key, data)
			select {
			case <-ctx.Done():
				return
			case <-time.After(c.interval):
			}
		}
	}()
	server := &http.Server{Addr: ":" + c.port, Handler: handler(data, c.origins), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	go func() {
		log.Printf("discovery API listening on :%s", c.port)
		if e := server.ListenAndServe(); e != nil && e != http.ErrServerClosed {
			log.Printf("HTTP server: %v", e)
			stop()
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server.Shutdown(shutdown)
	select {
	case <-done:
	case <-shutdown.Done():
	}
}
