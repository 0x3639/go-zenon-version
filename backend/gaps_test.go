package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/zenon-network/go-zenon/common/types"
	"github.com/zenon-network/go-zenon/consensus"
)

// Generate a linked chain with real deterministic elections. Baseline production
// comes only from A; later B produces despite its zero-production baseline.
func gapFixture(t *testing.T, rounds int) (*productionFixture, time.Time) {
	t.Helper()
	registry := readScheduleFixture(t).Pillars.List[:3]
	since := time.Unix(genesisUnix+int64(523350)*roundSeconds, 0)
	f := &productionFixture{registry: registry}
	appendHeader := func(ts int64, producer string) {
		height := uint64(100 + len(f.headers))
		previous := fmt.Sprintf("%064x", height-1)
		f.headers = append(f.headers, momentumHeader{Height: height, Hash: fmt.Sprintf("%064x", height), PreviousHash: previous, Timestamp: ts, Producer: producer, ChainIdentifier: 1})
	}
	for ts := since.Unix() - 10; ts < since.Unix()+3600; ts += 10 {
		appendHeader(ts, registry[0].Producer)
	}
	delegations, err := gapDelegations(registry)
	if err != nil {
		t.Fatal(err)
	}
	algorithm := consensus.NewElectionAlgorithm(consensus.NewConsensusContext(time.Unix(genesisUnix, 0)))
	for round := 0; round < rounds; round++ {
		start := since.Unix() + 3600 + int64(round)*300
		var proof momentumHeader
		for _, m := range f.headers {
			if m.Timestamp < start-300 {
				proof = m
			}
		}
		hash, err := types.HexToHash(proof.Hash)
		if err != nil {
			t.Fatal(err)
		}
		elected := algorithm.SelectProducers(consensus.NewAlgorithmContext(append([]*types.PillarDelegation(nil), delegations...), &types.HashHeight{Hash: hash, Height: proof.Height}))
		for i, p := range elected {
			if p.Producing.String() != registry[2].Producer {
				appendHeader(start+int64(i)*10, p.Producing.String())
			}
		}
	}
	appendHeader(since.Unix()+3600+int64(rounds)*300, registry[0].Producer)
	return f, since
}
func studyForFixture(t *testing.T, f *productionFixture, since time.Time) gapStudy {
	t.Helper()
	frontier := f.headers[len(f.headers)-1]
	s := productionSnapshot{Since: since.Format(time.RFC3339), GeneratedAt: time.Unix(frontier.Timestamp+1, 0).Format(time.RFC3339), Status: "ready", Complete: true, Last: &frontier, Frontier: &frontier}
	rows := []productionMomentum{}
	baseline := map[string]int{}
	for _, m := range f.headers[1:] {
		rows = append(rows, productionMomentum{momentumHeader: m})
		if m.Timestamp < since.Unix()+3600 {
			baseline[m.Producer]++
		}
	}
	if len(rows) > 500 {
		rows = rows[len(rows)-500:]
	}
	out, err := buildGapStudy(s, &f.headers[0], f.registry, baseline, rows)
	if err != nil {
		t.Fatal(err)
	}
	return out
}
func TestGapStudyBaselineIsFrozenAndWindowsBounded(t *testing.T) {
	f, since := gapFixture(t, 15)
	s := studyForFixture(t, f, since)
	if s.Status != "ready" || len(s.Rounds) != 12 || s.All != (gapCounts{360, 240, 120}) || s.Comparable != s.All || s.PriorProduction != (gapCounts{120, 120, 0}) || s.NoBaselineProduction != (gapCounts{240, 120, 120}) {
		t.Fatalf("incorrect comparison: %+v", s)
	}
	if *s.WindowStart != since.Unix()+4500 || *s.WindowEnd != s.Frontier.Timestamp {
		t.Fatal("included baseline or unclosed round")
	}
	for _, p := range s.Pillars {
		if p.Producer == f.registry[1].Producer && (p.BaselineCount != 0 || p.Group != "no-baseline-production" || p.Produced != 120) {
			t.Fatal("later production changed baseline membership")
		}
	}
	for _, r := range s.Rounds {
		if !r.Included || r.Matched != r.Produced {
			t.Fatal("lost replay checks")
		}
	}
}
func TestGapStudyExcludesMismatchedAndLowEvidenceRounds(t *testing.T) {
	f, since := gapFixture(t, 3)
	// Change a producer, preserving linked heights/hashes. This must invalidate the
	// entire first round's attribution, while its measured gaps stay visible.
	for i := range f.headers {
		if f.headers[i].Timestamp >= since.Unix()+3600 {
			f.headers[i].Producer = f.registry[2].Producer
			break
		}
	}
	s := studyForFixture(t, f, since)
	if s.Rounds[0].Included || s.Rounds[0].Reason != "producer-mismatch" || s.All.Scheduled != 90 || s.Comparable.Scheduled != 60 {
		t.Fatal("mismatched allocations counted")
	}
	f, since = gapFixture(t, 1)
	kept := append([]momentumHeader(nil), f.headers[:361]...)
	kept = append(kept, f.headers[361:365]...)
	kept = append(kept, f.headers[len(f.headers)-1])
	for i := range kept {
		kept[i].Height = uint64(i + 100)
		kept[i].Hash = fmt.Sprintf("%064x", i+100)
		kept[i].PreviousHash = fmt.Sprintf("%064x", i+99)
	}
	f.headers = kept
	s = studyForFixture(t, f, since)
	if s.Rounds[0].Reason != "too-few-produced-slots" || s.Comparable.Scheduled != 0 || s.All.Missed != 26 {
		t.Fatalf("weak round attributed: %+v", s)
	}
}
func TestGapStudyWaitingAndBrokenCoverage(t *testing.T) {
	f, since := gapFixture(t, 1)
	frontier := f.headers[350]
	snapshot := productionSnapshot{Since: since.Format(time.RFC3339), Complete: true, Frontier: &frontier}
	s, err := buildGapStudy(snapshot, &f.headers[0], f.registry, nil, nil)
	if err != nil || s.Status != "waiting" || s.BaselineComplete || s.WindowStart != nil || s.WindowEnd != nil {
		t.Fatal("baseline assessed early")
	}
	frontier.Timestamp = since.Unix() + 3600
	s, err = buildGapStudy(snapshot, &f.headers[0], f.registry, nil, nil)
	if err != nil || s.Status != "waiting" || !s.BaselineComplete || s.WindowStart != nil {
		t.Fatal("unclosed round assessed")
	}
	snapshot.Frontier = &f.headers[len(f.headers)-1]
	rows := []productionMomentum{}
	for _, m := range f.headers[361:] {
		rows = append(rows, productionMomentum{momentumHeader: m})
	}
	if _, err = buildGapStudy(snapshot, &f.headers[0], f.registry, nil, rows); err == nil {
		t.Fatal("accepted missing window predecessor")
	}
	rows = []productionMomentum{}
	for _, m := range f.headers[1:] {
		rows = append(rows, productionMomentum{momentumHeader: m})
	}
	rows[20].PreviousHash = fmt.Sprintf("%064x", 99999)
	if _, err = buildGapStudy(snapshot, &f.headers[0], f.registry, nil, rows); err == nil {
		t.Fatal("accepted discontinuous chain")
	}
}
func TestGapStudyStoreFailureStalenessAndReadOnlyAPI(t *testing.T) {
	f, since := gapFixture(t, 3)
	p, _ := productionTestStore(t, f)
	p.since = since
	p.state.Since = since.Format(time.RFC3339)
	syncProduction(t, p, f)
	if p.gaps.Status != "ready" || p.gaps.BaselineMomentums != 360 || p.gaps.NoBaselineProduction.Produced != 30 {
		t.Fatalf("incorrect database baseline: %+v", p.gaps)
	}
	p.gaps.GeneratedAt = time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	stamp := p.gaps.GeneratedAt
	scheduled := p.gaps.All.Scheduled
	recorder := httptest.NewRecorder()
	p.serveGaps(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/production/gaps", nil))
	var out gapStudy
	if err := json.Unmarshal(recorder.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Status != "stale" || out.GeneratedAt != stamp {
		t.Fatal("historical result marked fresh")
	}
	recorder = httptest.NewRecorder()
	p.serveGaps(recorder, httptest.NewRequest(http.MethodHead, "/api/v1/production/gaps", nil))
	if recorder.Body.Len() != 0 {
		t.Fatal("HEAD emitted body")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	p.updateGapStudy(ctx, p.snapshot)
	if p.gaps.Status != "unavailable" || p.gaps.GeneratedAt != stamp || p.gaps.All.Scheduled != scheduled || p.snapshot.Status != "ready" {
		t.Fatal("study failure corrupted production or retained evidence")
	}
	p.failure(fmt.Errorf("outage"))
	if p.gaps.All.Scheduled != scheduled || p.gaps.GeneratedAt != stamp {
		t.Fatal("failure refreshed historical study")
	}
}

func TestGapStudyProofCutoffIsExclusiveAndMissingProofIsNotAttributed(t *testing.T) {
 f,since:=gapFixture(t,1)
 s:=studyForFixture(t,f,since)
 var proof momentumHeader
 for _,m:=range f.headers {if m.Timestamp < s.Rounds[0].Start-300 {proof=m}}
 if s.Rounds[0].ProofHash==nil || *s.Rounds[0].ProofHash!=proof.Hash {t.Fatal("election proof must precede the cutoff strictly")}
 // Retain a window predecessor but remove the election-proof predecessor.
 rows:=[]productionMomentum{}
 for _,m:=range f.headers {if m.Timestamp >= s.Rounds[0].Start-300 {rows=append(rows,productionMomentum{momentumHeader:m})}}
 frontier:=f.headers[len(f.headers)-1]
 snapshot:=productionSnapshot{Since:since.Format(time.RFC3339),Complete:true,Frontier:&frontier}
 out,err:=buildGapStudy(snapshot,&f.headers[0],f.registry,nil,rows)
 if err!=nil || len(out.Rounds)!=1 || out.Rounds[0].Reason!="missing-proof" || out.Comparable.Scheduled!=0 || out.All.Missed!=10 {t.Fatalf("missing proof must remain unattributed: %+v %v",out,err)}
 // A non-round-aligned baseline cannot include a partly baseline round.
 shifted:=since.Add(10*time.Second);out,err=buildGapStudy(productionSnapshot{Since:shifted.Format(time.RFC3339),Complete:true,Frontier:&frontier},&f.headers[0],f.registry,nil,rows)
 if err!=nil || out.WindowStart!=nil || out.Status!="waiting" {t.Fatal("included a round overlapping the baseline")}
}
func TestGapStudyRouteUsesExistingCORSAndReadOnlyPolicy(t *testing.T) {
 f:=newProductionFixture(t);p,_:=productionTestStore(t,f);syncProduction(t,p,f)
 h:=handler(&store{production:p},map[string]bool{"https://0x3639.com":true})
 for _,method:=range []string{http.MethodGet,http.MethodHead,http.MethodPost} {
  r:=httptest.NewRequest(method,"/api/v1/production/gaps",nil);r.Header.Set("Origin","https://0x3639.com")
  w:=httptest.NewRecorder();h.ServeHTTP(w,r)
  expected:=200;if method==http.MethodPost{expected=405}
  if w.Code!=expected || w.Header().Get("Access-Control-Allow-Origin")!="https://0x3639.com" {t.Fatal("lost shared route policy")}
  if method==http.MethodHead && w.Body.Len()!=0 {t.Fatal("HEAD body")}
 }
 w:=httptest.NewRecorder();handler(&store{},nil).ServeHTTP(w,httptest.NewRequest(http.MethodGet,"/api/v1/production/gaps",nil))
 if w.Code!=503 {t.Fatal("missing database not handled")}
}
