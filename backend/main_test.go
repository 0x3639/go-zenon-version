package main

import (
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
)

func TestPublicTargets(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "224.0.0.1", "240.1.2.3", "192.0.2.1", "::1", "fc00::1", "::ffff:127.0.0.1", "2001:db8::1", "host.example"} {
		if publicIP(ip) {
			t.Errorf("accepted non-public target %s", ip)
		}
	}
	for _, ip := range []string{"8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"} {
		if !publicIP(ip) {
			t.Errorf("rejected public target %s", ip)
		}
	}
}
func TestDiscoveryPacketAuthentication(t *testing.T) {
	key, _ := crypto.GenerateKey()
	id := hex.EncodeToString(crypto.FromECDSAPub(&key.PublicKey)[1:])
	packet, err := encodePacket(key, 3, findPacket{Expiration: uint64(time.Now().Add(time.Second).Unix())})
	if err != nil {
		t.Fatal(err)
	}
	kind, _, err := decodePacket(packet, id)
	if err != nil || kind != 3 {
		t.Fatalf("round trip failed: %v", err)
	}
	if _, _, err = decodePacket(packet, "not-the-peer"); err == nil {
		t.Fatal("accepted wrong signer")
	}
	packet[len(packet)-1] ^= 1
	if _, _, err = decodePacket(packet, id); err == nil {
		t.Fatal("accepted tampered packet")
	}
	if _, _, err = decodePacket([]byte{1, 2}, id); err == nil {
		t.Fatal("accepted truncated packet")
	}
}
func TestValidIdentityAndExpiry(t *testing.T) {
	if validID(string(make([]byte, 128))) {
		t.Fatal("accepted invalid identity")
	}
	key, _ := crypto.GenerateKey()
	id := hex.EncodeToString(crypto.FromECDSAPub(&key.PublicKey)[1:])
	if !validID(id) {
		t.Fatal("rejected real identity")
	}
	if validExpiry(uint64(time.Now().Add(-time.Minute).Unix())) || validExpiry(uint64(time.Now().Add(time.Hour).Unix())) {
		t.Fatal("accepted invalid expiry")
	}
}
func TestReferralDoesNotRefreshOldVersion(t *testing.T) {
	n := newNode("key", "8.8.8.8", "v0.0.9 znn-node", "one", "p2p")
	n.LastSeen = "2020-01-01T00:00:00Z"
	nodes := map[string]Node{n.ID: n}
	mergeNode(nodes, newNode("key", "8.8.8.8", "", "two", "discovery"))
	if nodes[n.ID].LastSeen != n.LastSeen {
		t.Fatal("a referral refreshed a stale version")
	}
	if len(nodes[n.ID].Sources) != 2 {
		t.Fatal("lost referral provenance")
	}
}
func TestReadOnlyAPIAndCORS(t *testing.T) {
	data := &store{}
	data.publish(Snapshot{SchemaVersion: 1, Nodes: []Node{newNode("key", "8.8.8.8", "v0.0.9 znn-node", "seed", "peer")}, Sources: []Source{}, GeneratedAt: now()})
	h := handler(data, map[string]bool{"https://0x3639.github.io": true})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/network", nil)
	req.Header.Set("Origin", "https://0x3639.github.io")
	r := httptest.NewRecorder()
	h.ServeHTTP(r, req)
	if r.Code != 200 || r.Header().Get("Access-Control-Allow-Origin") != "https://0x3639.github.io" {
		t.Fatal("allowed browser cannot read API")
	}
	etag := r.Header().Get("ETag")
	req.Header.Set("If-None-Match", etag)
	cached := httptest.NewRecorder()
	h.ServeHTTP(cached, req)
	if cached.Code != 304 {
		t.Fatal("conditional caching failed")
	}
	req = httptest.NewRequest(http.MethodPost, "/api/v1/network", nil)
	r = httptest.NewRecorder()
	h.ServeHTTP(r, req)
	if r.Code != 405 {
		t.Fatal("API accepts writes")
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/nodes", nil)
	req.Header.Set("Origin", "https://other.example")
	r = httptest.NewRecorder()
	h.ServeHTTP(r, req)
	if r.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("unapproved origin received CORS permission")
	}
}
func TestEmptyServiceReadiness(t *testing.T) {
	data := &store{}
	data.publish(Snapshot{SchemaVersion: 1, Nodes: []Node{}, Sources: []Source{}})
	h := handler(data, nil)
	for path, want := range map[string]int{"/healthz": 200, "/readyz": 503, "/api/v1/network": 503, "/not-found": 404} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", path, nil))
		if r.Code != want {
			t.Errorf("%s got %d want %d", path, r.Code, want)
		}
	}
}

func TestConcurrentSnapshotReads(t *testing.T) {
	data := &store{}
	snapshot := Snapshot{SchemaVersion: 1, Nodes: []Node{newNode("key", "8.8.8.8", "v0.0.9 znn-node", "seed", "peer")}, Sources: []Source{}, GeneratedAt: now()}
	data.publish(snapshot)
	h := handler(data, nil)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 30; j++ {
				data.publish(snapshot)
				r := httptest.NewRecorder()
				h.ServeHTTP(r, httptest.NewRequest("GET", "/api/v1/network", nil))
				if r.Code != 200 || r.Body.Len() == 0 { t.Error("missing concurrent snapshot") }
			}
		}()
	}
	wg.Wait()
}
