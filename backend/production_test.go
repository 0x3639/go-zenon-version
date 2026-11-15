package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type productionFixture struct {
	headers  []momentumHeader
	registry []schedulePillar
	fail     bool
}

func newProductionFixture(t *testing.T) *productionFixture {
	f := readScheduleFixture(t)
	start, _ := time.Parse(time.RFC3339, defaultProductionSince)
	// The boundary is inclusive, and the first included interval uses its predecessor.
	stamps := []int64{start.Unix() - 10, start.Unix(), start.Unix() + 20, start.Unix() + 50}
	out := &productionFixture{registry: f.Pillars.List[:3]}
	for i, stamp := range stamps {
		out.headers = append(out.headers, momentumHeader{Height: uint64(i + 100), Hash: fmt.Sprintf("%064x", i+1), PreviousHash: fmt.Sprintf("%064x", i), Timestamp: stamp, Producer: out.registry[i%2].Producer, ChainIdentifier: 1})
	}
	return out
}
func (f *productionFixture) rpc(_ context.Context, _ string, method string, target any, args ...any) error {
	if f.fail {
		return errors.New("public node unavailable")
	}
	var result any
	switch method {
	case "ledger.getFrontierMomentum":
		result = f.headers[len(f.headers)-1]
	case "embedded.pillar.getAll":
		result = map[string]any{"count": len(f.registry), "list": f.registry}
	case "ledger.getMomentumsByHeight":
		start, count := args[0].(uint64), uint64(1)
		switch n := args[1].(type) {
		case int:
			count = uint64(n)
		case uint64:
			count = n
		}
		list := []momentumHeader{}
		for h := start; h < start+count; h++ {
			if h < 100 {
				m := f.headers[0]
				m.Height = h
				m.Timestamp -= int64(100-h) * 10
				m.Hash = fmt.Sprintf("%064x", h+1000)
				list = append(list, m)
			} else if int(h-100) < len(f.headers) {
				list = append(list, f.headers[h-100])
			}
		}
		result = map[string]any{"list": list}
	default:
		return errors.New("unexpected method")
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, target)
}
func productionTestStore(t *testing.T, f *productionFixture) (*productionStore, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "history.sqlite")
	p, err := openProduction(path, defaultProductionSince)
	if err != nil {
		t.Fatal(err)
	}
	p.rpc = f.rpc
	t.Cleanup(func() { p.db.Close() })
	return p, path
}
func syncProduction(t *testing.T, p *productionStore, f *productionFixture) {
	t.Helper()
	if err := p.syncSource(context.Background(), "fixture", time.Unix(f.headers[len(f.headers)-1].Timestamp+1, 0)); err != nil {
		t.Fatal(err)
	}
}
func TestProductionCountsBoundaryIntervalsAndRestart(t *testing.T) {
	f := newProductionFixture(t)
	p, path := productionTestStore(t, f)
	syncProduction(t, p, f)
	s := p.snapshot
	if !s.Complete || s.TotalMomentums != 3 || *s.FirstHeight != 101 || len(s.Pillars) != 3 || s.Pillars[0].Count != 2 || s.Pillars[2].Count != 0 {
		t.Fatalf("wrong counts: %+v", s)
	}
	if *s.Intervals.AverageSeconds != 20 || *s.Intervals.ShortestSeconds != 10 || *s.Intervals.LongestSeconds != 30 || *s.Intervals.LatestSeconds != 30 {
		t.Fatalf("wrong intervals: %+v", s.Intervals)
	}
	if s.Recent[2].Timestamp != p.since.Unix() || s.Recent[2].IntervalSeconds != 10 {
		t.Fatal("excluded boundary or lost predecessor")
	}
	syncProduction(t, p, f)
	if p.snapshot.TotalMomentums != 3 {
		t.Fatal("double counted duplicate poll")
	}
	p.db.Close()
	restored, err := openProduction(path, defaultProductionSince)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.db.Close()
	restored.rpc = f.rpc
	if restored.snapshot.Status != "stale" || restored.snapshot.TotalMomentums != 3 || restored.snapshot.GeneratedAt != s.GeneratedAt {
		t.Fatal("restart lost history or refreshed timestamp")
	}
	syncProduction(t, restored, f)
	if restored.snapshot.TotalMomentums != 3 {
		t.Fatal("restart double counted")
	}
}
func TestProductionRejectsBrokenHistoryAndRetainsFailedSnapshot(t *testing.T) {
	f := newProductionFixture(t)
	p, _ := productionTestStore(t, f)
	f.headers[2].PreviousHash = strings.Repeat("f", 64)
	if err := p.syncSource(context.Background(), "fixture", time.Unix(f.headers[3].Timestamp+1, 0)); err == nil {
		t.Fatal("accepted broken link")
	}
	if p.snapshot.TotalMomentums != 0 {
		t.Fatal("partly committed broken batch")
	}
	f.headers[2].PreviousHash = f.headers[1].Hash
	syncProduction(t, p, f)
	stamp := p.snapshot.GeneratedAt
	f.fail = true
	err := p.syncSource(context.Background(), "fixture", time.Unix(f.headers[3].Timestamp+20, 0))
	if err == nil {
		t.Fatal("expected failure")
	}
	p.failure(err)
	if p.snapshot.Status != "unavailable" || p.snapshot.TotalMomentums != 3 || p.snapshot.GeneratedAt != stamp {
		t.Fatal("failure changed saved evidence")
	}
}
func TestProductionReorgAndConflictingFallback(t *testing.T) {
	f := newProductionFixture(t)
	p, _ := productionTestStore(t, f)
	syncProduction(t, p, f)
	f.headers[3].Hash = strings.Repeat("a", 64)
	f.headers[3].Producer = f.registry[2].Producer
	if err := p.syncSource(context.Background(), "other", time.Unix(f.headers[3].Timestamp+1, 0)); err == nil {
		t.Fatal("mixed conflicting fallback chain")
	}
	if p.snapshot.Last.Hash == f.headers[3].Hash {
		t.Fatal("fallback changed history")
	}
	syncProduction(t, p, f)
	if p.snapshot.TotalMomentums != 3 || p.snapshot.Last.Hash != f.headers[3].Hash || p.snapshot.Pillars[2].Count != 1 {
		t.Fatal("reorg failed to rebuild exact counts")
	}
}
func TestProductionBoundedBackfillAndHistoryPagination(t *testing.T) {
	f := newProductionFixture(t)
	for len(f.headers) < 605 {
		last := f.headers[len(f.headers)-1]
		n := last
		n.Height++
		n.PreviousHash = last.Hash
		n.Hash = fmt.Sprintf("%064x", n.Height+1000)
		n.Timestamp += 10
		f.headers = append(f.headers, n)
	}
	p, _ := productionTestStore(t, f)
	syncProduction(t, p, f)
	if p.snapshot.Complete || p.snapshot.Status != "backfilling" || p.snapshot.TotalMomentums != 500 || p.snapshot.Remaining != 104 {
		t.Fatalf("backfill was not bounded: %+v", p.snapshot)
	}
	syncProduction(t, p, f)
	if !p.snapshot.Complete || p.snapshot.TotalMomentums != 604 {
		t.Fatal("backfill did not resume")
	}
	h := handler(&store{production: p}, map[string]bool{"https://0x3639.com": true})
	url := fmt.Sprintf("/api/v1/production/momentums?tipHeight=704&tipHash=%s&beforeHeight=705&limit=2", p.snapshot.Last.Hash)
	req := httptest.NewRequest("GET", url, nil)
	req.Header.Set("Origin", "https://0x3639.com")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	var page struct {
		Data []productionMomentum `json:"data"`
		Next uint64               `json:"nextBeforeHeight"`
	}
	json.Unmarshal(w.Body.Bytes(), &page)
	if w.Code != 200 || len(page.Data) != 2 || page.Data[0].Height != 704 || page.Next != 703 || w.Header().Get("Access-Control-Allow-Origin") == "" {
		t.Fatalf("bad page: %s", w.Body.String())
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", strings.Replace(url, "beforeHeight=705", "beforeHeight=703", 1), nil))
	json.Unmarshal(w.Body.Bytes(), &page)
	if len(page.Data) != 2 || page.Data[0].Height != 702 {
		t.Fatal("overlapping pages")
	}
	for _, tc := range []struct {
		method, url string
		code        int
	}{{"GET", strings.Replace(url, "limit=2", "limit=101", 1), 400}, {"GET", strings.Replace(url, p.snapshot.Last.Hash, strings.Repeat("0", 64), 1), 409}, {"POST", "/api/v1/production", 405}, {"HEAD", "/api/v1/production", 200}} {
		w = httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(tc.method, tc.url, nil))
		if w.Code != tc.code {
			t.Fatalf("%s: %d", tc.url, w.Code)
		}
		if tc.method == http.MethodHead && w.Body.Len() != 0 {
			t.Fatal("HEAD has body")
		}
	}
}
func TestProductionCutoffChangeAndValidation(t *testing.T) {
	for _, bad := range []string{"yesterday", "2026-11-15T15:49:00.5Z", "2021-11-24T12:00:00Z"} {
		if _, err := productionSince(bad); err == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
	local, err := productionSince("2026-11-15T09:49:00-06:00")
	if err != nil || local.Format(time.RFC3339) != defaultProductionSince {
		t.Fatal("CST conversion")
	}
	f := newProductionFixture(t)
	p, path := productionTestStore(t, f)
	syncProduction(t, p, f)
	p.db.Close()
	changed, err := openProduction(path, "2026-11-15T15:49:20Z")
	if err != nil {
		t.Fatal(err)
	}
	defer changed.db.Close()
	changed.rpc = f.rpc
	syncProduction(t, changed, f)
	if changed.snapshot.TotalMomentums != 2 || *changed.snapshot.FirstHeight != 102 {
		t.Fatal("cutoff change mixed histories")
	}
}

func TestProductionStaleSourceAndFutureBoundary(t *testing.T) {
	f := newProductionFixture(t)
	p, _ := productionTestStore(t, f)
	syncProduction(t, p, f)
	stamp := p.snapshot.GeneratedAt
	err := p.syncSource(context.Background(), "fixture", time.Unix(f.headers[3].Timestamp+91, 0))
	if err == nil {
		t.Fatal("accepted stale chain tip")
	}
	p.failure(err)
	if p.snapshot.GeneratedAt != stamp || p.snapshot.TotalMomentums != 3 {
		t.Fatal("stale source replaced history")
	}
	p.since = time.Unix(f.headers[3].Timestamp+20, 0)
	if err = p.reset(context.Background()); err != nil {
		t.Fatal(err)
	}
	syncProduction(t, p, f)
	if !p.snapshot.Complete || p.snapshot.TotalMomentums != 0 || p.snapshot.FirstHeight != nil || p.snapshot.Intervals.AverageSeconds != nil {
		t.Fatal("future window fabricated production")
	}
	last := f.headers[3]
	last.Height++
	last.PreviousHash = last.Hash
	last.Hash = strings.Repeat("b", 64)
	last.Timestamp += 10
	f.headers = append(f.headers, last)
	syncProduction(t, p, f)
	if p.snapshot.TotalMomentums != 0 {
		t.Fatal("counted before cutoff")
	}
	last.Height++
	last.PreviousHash = last.Hash
	last.Hash = strings.Repeat("c", 64)
	last.Timestamp += 10
	f.headers = append(f.headers, last)
	syncProduction(t, p, f)
	if p.snapshot.TotalMomentums != 1 || *p.snapshot.Intervals.LatestSeconds != 10 {
		t.Fatal("failed to begin at future cutoff")
	}
}

func TestProductionInitialSearchAllowsSlowHealthyRPC(t *testing.T) {
	f := newProductionFixture(t)
	p, _ := productionTestStore(t, f)
	const tip uint64 = 14700000
	end := p.since.Unix() + 20
	header := func(height uint64) momentumHeader {
		return momentumHeader{Height: height, Hash: fmt.Sprintf("%064x", height), PreviousHash: fmt.Sprintf("%064x", height-1), Timestamp: end - int64(tip-height)*10, Producer: f.registry[0].Producer, ChainIdentifier: 1}
	}
	// Account for two seconds per successful RPC without making this regression
	// test sleep for a minute. Honor the caller's real budget with a logical clock.
	started, elapsed, calls := time.Now(), time.Duration(0), 0
	p.rpc = func(ctx context.Context, _ string, method string, target any, args ...any) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		deadline, ok := ctx.Deadline()
		if !ok {
			t.Fatal("source attempt must have a deadline")
		}
		elapsed += 2 * time.Second
		calls++
		if started.Add(elapsed).After(deadline) {
			return context.DeadlineExceeded
		}
		var result any
		switch method {
		case "ledger.getFrontierMomentum":
			result = header(tip)
		case "embedded.pillar.getAll":
			result = map[string]any{"count": len(f.registry), "list": f.registry}
		case "ledger.getMomentumsByHeight":
			start := args[0].(uint64)
			count := uint64(1)
			if n, ok := args[1].(uint64); ok {
				count = n
			}
			rows := []momentumHeader{}
			for h := start; h < start+count; h++ {
				rows = append(rows, header(h))
			}
			result = map[string]any{"list": rows}
		default:
			return errors.New("unexpected RPC")
		}
		raw, err := json.Marshal(result)
		if err != nil {
			return err
		}
		return json.Unmarshal(raw, target)
	}
	at := time.Unix(end+1, 0)
	short, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	err := p.syncSource(short, "slow", at)
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) || p.snapshot.TotalMomentums != 0 {
		t.Fatal("fixture must reproduce the original initialization failure")
	}
	started, elapsed, calls = time.Now(), 0, 0
	if err = p.syncAttempt(context.Background(), "slow", at); err != nil {
		t.Fatal(err)
	}
	if calls < 25 || elapsed <= 45*time.Second || !p.snapshot.Complete || p.snapshot.TotalMomentums != 3 {
		t.Fatalf("slow search failed: calls=%d elapsed=%s snapshot=%+v", calls, elapsed, p.snapshot)
	}
	// Subsequent polling remains bounded at 45s, and parent cancellation wins.
	p.rpc = func(ctx context.Context, _ string, _ string, _ any, _ ...any) error {
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 45*time.Second {
			t.Fatal("normal polling got an initialization budget")
		}
		return ctx.Err()
	}
	stopped, stop := context.WithCancel(context.Background())
	stop()
	if err = p.syncAttempt(stopped, "slow", at); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
}
