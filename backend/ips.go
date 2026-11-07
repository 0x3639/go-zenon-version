package main

import (
	"net/netip"
	"sort"
)

type IPRecord struct {
	IP             string   `json:"ip"`
	NodeIDs        []string `json:"nodeIds"`
	ConfirmedNodes int      `json:"confirmedNodes"`
	LastAttemptAt  string   `json:"lastAttemptAt,omitempty"`
	LastSuccessAt  string   `json:"lastSuccessAt,omitempty"`
}

func uniqueIPs(nodes []Node) []IPRecord {
	byIP := map[string]*IPRecord{}
	for _, n := range nodes {
		if !publicIP(n.IP) {
			continue
		}
		address, _ := netip.ParseAddr(n.IP)
		ip := address.Unmap().String()
		if byIP[ip] == nil {
			byIP[ip] = &IPRecord{IP: ip, NodeIDs: []string{}}
		}
		record := byIP[ip]
		record.NodeIDs = unique(record.NodeIDs, n.ID)
		h := n.Handshake
		if h == nil || h.IP != n.IP || h.Port != n.TCP {
			continue
		}
		if h.Status == "confirmed" {
			record.ConfirmedNodes++
		}
		if h.AttemptedAt > record.LastAttemptAt {
			record.LastAttemptAt = h.AttemptedAt
		}
		if h.LastSuccessAt > record.LastSuccessAt {
			record.LastSuccessAt = h.LastSuccessAt
		}
	}
	result := make([]IPRecord, 0, len(byIP))
	for _, r := range byIP {
		sort.Strings(r.NodeIDs)
		result = append(result, *r)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].IP < result[j].IP })
	return result
}
