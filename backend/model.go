package main

import (
	"encoding/hex"
	"net/netip"
	"regexp"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
)

type Node struct {
	ID               string   `json:"id"`
	IP               string   `json:"ip"`
	Name             string   `json:"name"`
	Version          *string  `json:"version"`
	ReportedVersions []string `json:"reportedVersions"`
	Commit           *string  `json:"commit"`
	Evidence         string   `json:"evidence"`
	Sources          []string `json:"sources"`
	RPCEndpoints     []string `json:"rpcEndpoints"`
	FirstSeen        string   `json:"firstSeen"`
	LastSeen         string   `json:"lastSeen"`
	TCP              uint16   `json:"tcpPort,omitempty"`
	UDP              uint16   `json:"udpPort,omitempty"`
}
type Source struct {
	Endpoint  string  `json:"endpoint"`
	Status    string  `json:"status"`
	PeerCount int     `json:"peerCount"`
	NodeID    *string `json:"nodeId"`
	Error     string  `json:"error,omitempty"`
	CheckedAt string  `json:"checkedAt"`
}
type Release struct {
	Version   string `json:"version"`
	Tag       string `json:"tag"`
	URL       string `json:"url"`
	CheckedAt string `json:"checkedAt"`
}
type Snapshot struct {
	SchemaVersion        int      `json:"schemaVersion"`
	StartedAt            string   `json:"startedAt"`
	GeneratedAt          string   `json:"generatedAt"`
	Mode                 string   `json:"mode"`
	Nodes                []Node   `json:"nodes"`
	Sources              []Source `json:"sources"`
	Limited              bool     `json:"limited"`
	Release              *Release `json:"release"`
	Scanning             bool     `json:"scanning"`
	PillarCount          *int     `json:"pillarCount"`
	PillarCountCheckedAt string   `json:"pillarCountCheckedAt,omitempty"`
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

var versionPattern = regexp.MustCompile(`(?:^|[ /])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?:$|[ /])`)

func version(name string) *string {
	match := versionPattern.FindStringSubmatch(name)
	if len(match) < 2 {
		return nil
	}
	v := "v" + match[1]
	return &v
}
func unique(values []string, value string) []string {
	for _, s := range values {
		if s == value {
			return values
		}
	}
	return append(values, value)
}
func validID(id string) bool {
	raw, err := hex.DecodeString(id)
	if err != nil || len(raw) != 64 {
		return false
	}
	_, err = crypto.UnmarshalPubkey(append([]byte{4}, raw...))
	return err == nil
}

var excluded = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"), netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"), netip.MustParsePrefix("2001:db8::/32"),
}

func publicIP(raw string) bool {
	ip, err := netip.ParseAddr(raw)
	if err != nil {
		return false
	}
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return false
	}
	for _, prefix := range excluded {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}
func bounded(s string, limit int) string {
	if len(s) > limit {
		return s[:limit]
	}
	return s
}
func newNode(id, ip, name, source, evidence string) Node {
	v := version(name)
	versions := []string{}
	if v != nil {
		versions = append(versions, *v)
	}
	return Node{ID: strings.ToLower(id), IP: ip, Name: bounded(name, 512), Version: v,
		ReportedVersions: versions, Evidence: evidence, Sources: []string{source}, RPCEndpoints: []string{},
		FirstSeen: now(), LastSeen: now(), TCP: 35995, UDP: 35995}
}
