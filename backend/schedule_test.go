package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

type scheduleFixture struct {
	Frontier momentumHeader `json:"frontier"`
	Recent   struct {
		List []momentumHeader `json:"list"`
	} `json:"recent"`
	Pillars struct {
		List []schedulePillar `json:"list"`
	} `json:"pillars"`
}

func readScheduleFixture(t *testing.T) scheduleFixture {
	t.Helper()
	raw, err := os.ReadFile("testdata/momentum-schedule.json")
	if err != nil {
		t.Fatal(err)
	}
	var f scheduleFixture
	if err = json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}
func TestScheduleReplaysRealMomentumHistory(t *testing.T) {
	f := readScheduleFixture(t)
	s, err := buildSchedule(time.Unix(f.Frontier.Timestamp+1, 0), "fixture", f.Frontier, f.Recent.List, f.Pillars.List, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("replayed %d/%d momentums; %d slots", s.Matched, s.Checked, len(s.Slots))
	if s.Status != "ready" || s.Checked < 100 || s.Matched != s.Checked {
		t.Fatalf("real chain replay mismatch: %d/%d", s.Matched, s.Checked)
	}
	if len(s.Slots) != 90 {
		t.Fatalf("want previous, current, next rounds, got %d slots", len(s.Slots))
	}
	for _, slot := range s.Slots {
		if slot.Version.Version != nil || slot.Version.Reason != "no-pillar-peer-link" {
			t.Fatal("invented a pillar version")
		}
	}
	for _, round := range s.Rounds {
		var wanted momentumHeader
		for _, m := range f.Recent.List {
			if m.Timestamp < round.ProofCutoff && m.Timestamp > wanted.Timestamp {
				wanted = m
			}
		}
		if round.ProofHash != wanted.Hash {
			t.Fatal("proof cutoff must be exclusive")
		}
	}
}
func TestScheduleRejectsMixedHistoryAndWrongChain(t *testing.T) {
	f := readScheduleFixture(t)
	at := time.Unix(f.Frontier.Timestamp+1, 0)
	f.Recent.List[8].PreviousHash = strings.Repeat("0", 64)
	if _, err := buildSchedule(at, "fixture", f.Frontier, f.Recent.List, f.Pillars.List, nil, nil); err == nil {
		t.Fatal("accepted discontinuous history")
	}
	f = readScheduleFixture(t)
	f.Frontier.ChainIdentifier = 2
	if _, err := buildSchedule(at, "fixture", f.Frontier, f.Recent.List, f.Pillars.List, nil, nil); err == nil {
		t.Fatal("accepted wrong chain")
	}
}
func TestScheduleDetectsPillarWeightChanges(t *testing.T) {
	f := readScheduleFixture(t)
	f.Pillars.List[0].Weight = "0"
	s, err := buildSchedule(time.Unix(f.Frontier.Timestamp+1, 0), "fixture", f.Frontier, f.Recent.List, f.Pillars.List, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if s.Matched == s.Checked {
		t.Fatal("weight reorder should expose replay mismatches")
	}
}
func TestPillarVersionRequiresExplicitFreshLink(t *testing.T) {
	at := time.Now()
	v := "v0.0.9"
	n := Node{ID: "peer", Version: &v, LastSeen: at.Format(time.RFC3339), Evidence: "p2p"}
	nodes := map[string]Node{"peer": n}
	if linkedVersion("pillar", nil, nodes, at).Version != nil {
		t.Fatal("inferred a link")
	}
	links := map[string]string{"pillar": "peer"}
	if linkedVersion("pillar", links, nodes, at).Version == nil {
		t.Fatal("missing configured version")
	}
	n.LastSeen = at.Add(-2 * time.Hour).Format(time.RFC3339)
	nodes[n.ID] = n
	if linkedVersion("pillar", links, nodes, at).Version != nil {
		t.Fatal("stale version presented as current")
	}
	if _, err := parsePillarPeers(`{"Pillar name":"1.2.3.4"}`); err == nil {
		t.Fatal("accepted name/IP inference")
	}
}
func TestScheduleFailurePreservesFreshnessAndReadOnlyAPI(t *testing.T) {
	s := &scheduleStore{}
	value := emptySchedule()
	value.GeneratedAt = "2026-01-01T00:00:00Z"
	value.Status = "ready"
	s.publish(value)
	s.failure(errors.New("source unavailable"))
	if s.value.GeneratedAt != value.GeneratedAt || s.value.Status != "unavailable" {
		t.Fatal("failure refreshed data")
	}
	data := &store{schedule: s}
	h := handler(data, map[string]bool{"https://0x3639.com": true})
	r := httptest.NewRequest("GET", "/api/v1/momentums", nil)
	r.Header.Set("Origin", "https://0x3639.com")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 503 || w.Header().Get("Access-Control-Allow-Origin") != "https://0x3639.com" {
		t.Fatal("bad unavailable response")
	}
	s.publish(value)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	r.Header.Set("If-None-Match", w.Header().Get("ETag"))
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 304 || w.Body.Len() != 0 {
		t.Fatal("conditional cache failed")
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/momentums", nil))
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatal("API must be read-only")
	}
}
func TestLiveSchedule(t *testing.T) {
	if os.Getenv("CHECK_LIVE_SCHEDULE") != "1" {
		t.Skip("explicit live check only")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	s, err := fetchSchedule(ctx, "wss://my.hc1node.com:35998", time.Now(), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("live status=%s height=%d replay=%d/%d slots=%d", s.Status, s.Frontier.Height, s.Matched, s.Checked, len(s.Slots))
	if s.Status != "ready" || len(s.Slots) < 60 {
		t.Fatal("live schedule not ready")
	}
}
