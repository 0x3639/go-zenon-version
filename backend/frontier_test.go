package main

import (
	"encoding/hex"
	"errors"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"
)

func testPeer(t *testing.T, ip string) Node {
	t.Helper()
	key, err := crypto.GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	return newNode(hex.EncodeToString(crypto.FromECDSAPub(&key.PublicKey)[1:]), ip, "v0.0.9 znn-node", "test", "peer")
}

func TestFrontierResumeAndDeduplicate(t *testing.T) {
	a, b, c := testPeer(t, "8.8.8.8"), testPeer(t, "8.8.8.8"), testPeer(t, "9.9.9.9")
	f := newFrontier()
	f.observe(a)
	f.observe(a)
	f.observe(b)
	if len(f.Pending) != 2 {
		t.Fatal("duplicate referral or shared-IP identity was mishandled")
	}
	first := f.take(1)[0]
	f.finish(first, true, now())
	f.observe(c)
	dir := t.TempDir()
	if err := f.save(dir); err != nil {
		t.Fatal(err)
	}
	resumed, err := loadFrontier(dir)
	if err != nil {
		t.Fatal(err)
	}
	resumed.beginPass() // A budget/restart must not replace the unfinished queue.
	if resumed.Pending[0] != candidateKey(b) || resumed.Pending[1] != candidateKey(c) {
		t.Fatal("pending order was lost")
	}
	resumed.observe(a)
	if len(resumed.Pending) != 2 {
		t.Fatal("completed peer requeued within the same pass")
	}
	if p := resumed.progress(); p.Attempted != 1 || p.UniqueIPs != 2 || p.ConfirmedIPs != 1 {
		t.Fatalf("incorrect progress: %+v", p)
	}
	remaining := resumed.take(2)
	for _, n := range remaining {
		resumed.finish(n, false, now())
	}
	resumed.beginPass()
	if len(resumed.Pending) != 3 {
		t.Fatal("next pass did not retry every retained endpoint")
	}
}

func TestInterruptedAndChangedEndpoint(t *testing.T) {
	n := testPeer(t, "8.8.8.8")
	f := newFrontier()
	f.observe(n)
	pending := f.take(1)[0]
	f.retryInterrupted(pending)
	f.retryInterrupted(pending)
	if len(f.Pending) != 1 || f.progress().Attempted != 0 {
		t.Fatal("interrupted probe counted as a failure or duplicated")
	}
	moved := n
	moved.IP = "9.9.9.9"
	f.observe(moved)
	if len(f.Pending) != 2 {
		t.Fatal("new address for the same identity was skipped")
	}
	private := n
	private.IP = "127.0.0.1"
	f.observe(private)
	if len(f.Pending) != 2 {
		t.Fatal("private target entered queue")
	}
}

func TestHandshakeEvidenceSurvivesReferralsAndFailures(t *testing.T) {
	n := testPeer(t, "8.8.8.8")
	nodes := map[string]Node{n.ID: n}
	stamp := "2026-11-07T01:00:00Z"
	recordHandshake(nodes, n, "v0.0.9 znn-node", nil, stamp)
	referral := n
	referral.Name = "v0.0.8 znn-node"
	referral.Version = version(referral.Name)
	mergeNode(nodes, referral)
	got := nodes[n.ID]
	if got.Handshake.Status != "confirmed" || got.Handshake.LastSuccessAt != stamp || *got.Version != "v0.0.9" || got.LastSeen != stamp {
		t.Fatal("referral replaced direct proof")
	}
	recordHandshake(nodes, n, "", errors.New("peer declined"), "2026-11-07T02:00:00Z")
	got = nodes[n.ID]
	if got.Handshake.Status != "failed" || got.Handshake.LastSuccessAt != stamp || got.Version == nil {
		t.Fatal("failed retry discarded prior evidence")
	}
	unknown := testPeer(t, "1.1.1.1")
	recordHandshake(nodes, unknown, "", errors.New("timeout"), stamp)
	if len(nodes) != 1 {
		t.Fatal("unobserved failed bootstrap inflated observed-node count")
	}
}

func TestUniqueIPsKeepDistinctIdentitiesAndEndpointProof(t *testing.T) {
	a, b := testPeer(t, "8.8.8.8"), testPeer(t, "8.8.8.8")
	nodes := map[string]Node{a.ID: a, b.ID: b}
	recordHandshake(nodes, a, a.Name, nil, now())
	ips := uniqueIPs([]Node{nodes[a.ID], nodes[b.ID]})
	if len(ips) != 1 || len(ips[0].NodeIDs) != 2 || ips[0].ConfirmedNodes != 1 {
		t.Fatal("IP grouping lost identities or evidence")
	}
	a = nodes[a.ID]
	a.IP = "9.9.9.9"
	ips = uniqueIPs([]Node{a})
	if ips[0].ConfirmedNodes != 0 || ips[0].LastSuccessAt != "" {
		t.Fatal("old-address success confirmed a different endpoint")
	}
}
