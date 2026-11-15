package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"math/big"
	"net/http"
	"sort"
	"time"

	"github.com/zenon-network/go-zenon/common/types"
	"github.com/zenon-network/go-zenon/consensus"
)

const gapMethod = "baseline-holdout-current-weights-v1"
const gapBaselineSeconds int64 = 3600
const gapWindowSeconds int64 = 3600
const gapMinReplay = 5

type gapCounts struct {
	Scheduled int `json:"scheduled"`
	Produced  int `json:"produced"`
	Missed    int `json:"missed"`
}
type gapPillar struct {
	Producer      string `json:"producer"`
	Name          string `json:"name"`
	BaselineCount int    `json:"baselineCount"`
	Group         string `json:"group"`
	gapCounts
}
type gapRound struct {
	Start       int64   `json:"start"`
	End         int64   `json:"end"`
	ProofHeight *uint64 `json:"proofHeight"`
	ProofHash   *string `json:"proofHash"`
	Produced    int     `json:"produced"`
	Matched     int     `json:"matched"`
	Missed      int     `json:"missed"`
	Included    bool    `json:"included"`
	Reason      string  `json:"reason"`
}
type gapStudy struct {
	SchemaVersion        int             `json:"schemaVersion"`
	Method               string          `json:"method"`
	GeneratedAt          string          `json:"generatedAt"`
	Source               string          `json:"source"`
	Status               string          `json:"status"`
	Error                string          `json:"error,omitempty"`
	BaselineStart        int64           `json:"baselineStart"`
	BaselineEnd          int64           `json:"baselineEnd"`
	BaselineComplete     bool            `json:"baselineComplete"`
	BaselineMomentums    int             `json:"baselineMomentums"`
	WindowStart          *int64          `json:"windowStart"`
	WindowEnd            *int64          `json:"windowEnd"`
	Frontier             *momentumHeader `json:"frontier"`
	MinimumReplay        int             `json:"minimumReplay"`
	All                  gapCounts       `json:"all"`
	Comparable           gapCounts       `json:"comparable"`
	NoBaselineProduction gapCounts       `json:"noBaselineProduction"`
	PriorProduction      gapCounts       `json:"priorProduction"`
	Rounds               []gapRound      `json:"rounds"`
	Pillars              []gapPillar     `json:"pillars"`
}

func emptyGapStudy(s productionSnapshot) gapStudy {
	since, _ := time.Parse(time.RFC3339, s.Since)
	return gapStudy{SchemaVersion: 1, Method: gapMethod, GeneratedAt: s.GeneratedAt, Source: s.Source, Status: "waiting", BaselineStart: since.Unix(), BaselineEnd: since.Unix() + gapBaselineSeconds, Frontier: s.Frontier, MinimumReplay: gapMinReplay, Rounds: []gapRound{}, Pillars: []gapPillar{}}
}
func gapDelegations(registry []schedulePillar) ([]*types.PillarDelegation, error) {
	if len(registry) == 0 || len(registry) > 1000 {
		return nil, errors.New("pillar weights unavailable")
	}
	out := make([]*types.PillarDelegation, 0, len(registry))
	addresses, names := map[string]bool{}, map[string]bool{}
	total := new(big.Int)
	for _, p := range registry {
		addr, err := types.ParseAddress(p.Producer)
		weight, ok := new(big.Int).SetString(p.Weight, 10)
		if err != nil || !ok || weight.Sign() < 0 || weight.BitLen() > 256 || len(p.Name) == 0 || len(p.Name) > 128 || addresses[p.Producer] || names[p.Name] {
			return nil, errors.New("invalid election inputs")
		}
		addresses[p.Producer] = true
		names[p.Name] = true
		total.Add(total, weight)
		out = append(out, &types.PillarDelegation{Name: p.Name, Producing: addr, Weight: weight})
	}
	if total.Sign() == 0 {
		return nil, errors.New("public node has no usable election weights")
	}
	return out, nil
}
func addGapCounts(to *gapCounts, from gapCounts) {
	to.Scheduled += from.Scheduled
	to.Produced += from.Produced
	to.Missed += from.Missed
}

// Groups use ONLY the first hour's records. Later production never changes a
// group's membership: a previously silent pillar can contradict the hypothesis.
// Allocation remains a reconstruction from current cached RPC weights, not a
// historical election record. Reject an entire round if any producer disagrees.
func buildGapStudy(s productionSnapshot, anchor *momentumHeader, registry []schedulePillar, baseline map[string]int, headers []productionMomentum) (gapStudy, error) {
	out := emptyGapStudy(s)
	if !s.Complete || s.Frontier == nil {
		out.Error = "Waiting for complete production history."
		return out, nil
	}
	if s.Frontier.Timestamp < out.BaselineEnd {
		out.Error = "Collecting the first hour of production before testing later slots."
		return out, nil
	}
	out.BaselineComplete = true
	for _, count := range baseline {
		out.BaselineMomentums += count
	}
	end := genesisUnix + (s.Frontier.Timestamp-genesisUnix)/roundSeconds*roundSeconds
	firstRound := genesisUnix + (out.BaselineEnd-genesisUnix+roundSeconds-1)/roundSeconds*roundSeconds
	start := max(firstRound, end-gapWindowSeconds)
	if start >= end {
		out.Error = "Waiting for the first complete five-minute round after the baseline hour."
		return out, nil
	}
	out.WindowStart = &start
	out.WindowEnd = &end
	delegations, err := gapDelegations(registry)
	if err != nil {
		return out, err
	}
	observed := map[int64]momentumHeader{}
	sort.Slice(headers, func(i, j int) bool { return headers[i].Height < headers[j].Height })
	for i, m := range headers {
		if err = validateProductionHeader(m.momentumHeader, time.Unix(s.Frontier.Timestamp, 0)); err != nil {
			return out, err
		}
		if i > 0 && (m.Height != headers[i-1].Height+1 || m.PreviousHash != headers[i-1].Hash || m.Timestamp <= headers[i-1].Timestamp) {
			return out, errors.New("gap study history is not contiguous")
		}
		observed[m.Timestamp] = m.momentumHeader
	}
	if len(headers) == 0 || headers[len(headers)-1].Hash != s.Frontier.Hash {
		return out, errors.New("gap study does not reach the checked frontier")
	}
	// The header just before the test window establishes complete empty-slot coverage.
	if headers[0].Timestamp >= start && (anchor == nil || anchor.Timestamp >= start || anchor.Hash != headers[0].PreviousHash) {
		return out, errors.New("gap study lacks the test window predecessor")
	}
	algorithm := consensus.NewElectionAlgorithm(consensus.NewConsensusContext(time.Unix(genesisUnix, 0)))
	byProducer := map[string]gapPillar{}
	for roundStart := start; roundStart < end; roundStart += roundSeconds {
		r := gapRound{Start: roundStart, End: roundStart + roundSeconds, Reason: "missing-proof"}
		for ts := r.Start; ts < r.End; ts += slotSeconds {
			if _, ok := observed[ts]; ok {
				r.Produced++
			}
		}
		r.Missed = 30 - r.Produced
		addGapCounts(&out.All, gapCounts{30, r.Produced, r.Missed})
		cutoff := roundStart - roundSeconds
		var proof *momentumHeader
		if anchor != nil && anchor.Timestamp < cutoff && headers[0].PreviousHash == anchor.Hash && headers[0].Height == anchor.Height+1 {
			copy := *anchor
			proof = &copy
		}
		for _, m := range headers {
			if m.Timestamp < cutoff {
				copy := m.momentumHeader
				proof = &copy
			} else {
				break
			}
		}
		if proof == nil {
			out.Rounds = append(out.Rounds, r)
			continue
		}
		bytes, err := hex.DecodeString(proof.Hash)
		if err != nil || len(bytes) != 32 {
			return out, errors.New("invalid election proof hash")
		}
		r.ProofHeight = &proof.Height
		r.ProofHash = &proof.Hash
		var hash types.Hash
		copy(hash[:], bytes)
		elected := algorithm.SelectProducers(consensus.NewAlgorithmContext(append([]*types.PillarDelegation(nil), delegations...), &types.HashHeight{Hash: hash, Height: proof.Height}))
		if len(elected) != 30 {
			return out, errors.New("unexpected election size")
		}
		for i, p := range elected {
			if m, ok := observed[roundStart+int64(i)*slotSeconds]; ok && m.Producer == p.Producing.String() {
				r.Matched++
			}
		}
		switch {
		case r.Matched != r.Produced:
			r.Reason = "producer-mismatch"
		case r.Produced < gapMinReplay:
			r.Reason = "too-few-produced-slots"
		default:
			r.Included = true
			r.Reason = "replay-matched"
		}
		out.Rounds = append(out.Rounds, r)
		if !r.Included {
			continue
		}
		addGapCounts(&out.Comparable, gapCounts{30, r.Produced, r.Missed})
		for i, p := range elected {
			producer := p.Producing.String()
			row := byProducer[producer]
			row.Producer = producer
			row.Name = p.Name
			row.BaselineCount = baseline[producer]
			row.Group = "no-baseline-production"
			if row.BaselineCount > 0 {
				row.Group = "prior-production"
			}
			counts := gapCounts{Scheduled: 1}
			if _, ok := observed[roundStart+int64(i)*slotSeconds]; ok {
				counts.Produced = 1
			} else {
				counts.Missed = 1
			}
			addGapCounts(&row.gapCounts, counts)
			byProducer[producer] = row
			if row.BaselineCount == 0 {
				addGapCounts(&out.NoBaselineProduction, counts)
			} else {
				addGapCounts(&out.PriorProduction, counts)
			}
		}
	}
	for _, p := range byProducer {
		out.Pillars = append(out.Pillars, p)
	}
	sort.Slice(out.Pillars, func(i, j int) bool {
		a, b := out.Pillars[i], out.Pillars[j]
		if a.Missed != b.Missed {
			return a.Missed > b.Missed
		}
		return a.Producer < b.Producer
	})
	out.Status = "ready"
	return out, nil
}

func (p *productionStore) updateGapStudy(ctx context.Context, s productionSnapshot) {
	out := emptyGapStudy(s)
	if s.Status != "ready" || !s.Complete || p.state.Anchor == nil {
		out.Status = s.Status
		if out.Status == "backfilling" {
			out.Status = "waiting"
		}
		out.Error = "Waiting for fresh, complete production history."
		p.mu.Lock()
		p.gaps = out
		p.mu.Unlock()
		return
	}
	// Strictly increasing ten-second headers bound the first hour to 360 records
	// and the test window plus election-proof lookback to fewer than 500 records.
	// Primary-key ranges avoid full-history scans as the production database grows.
	queryCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	baseline := map[string]int{}
	rows, err := p.db.QueryContext(queryCtx, "SELECT producer,count(*) FROM momentums WHERE height>? AND height<=? AND timestamp<? GROUP BY producer", p.state.Anchor.Height, p.state.Anchor.Height+360, out.BaselineEnd)
	if err == nil {
		for rows.Next() {
			var producer string
			var count int
			if err = rows.Scan(&producer, &count); err != nil {
				break
			}
			baseline[producer] = count
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
	}
	var headers []productionMomentum
	if err == nil && s.Last != nil {
		headers, err = readProductionRows(queryCtx, p.db, s.Last.Height+1, 500)
	}
	if err == nil {
		out, err = buildGapStudy(s, p.state.Anchor, p.state.Registry, baseline, headers)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if err != nil {
		log.Printf("slot study: %v", err)
		if p.gaps.SchemaVersion == 1 {
			out = p.gaps
		}
		out.Status = "unavailable"
		out.Error = "The slot study could not refresh. Existing results retain their original observation time."
	}
	p.gaps = out
}
func (p *productionStore) serveGaps(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if p == nil {
		http.Error(w, `{"error":"slot study unavailable"}`, 503)
		return
	}
	p.mu.RLock()
	out := p.gaps
	p.mu.RUnlock()
	if out.GeneratedAt != "" {
		stamp, _ := time.Parse(time.RFC3339, out.GeneratedAt)
		if (time.Since(stamp) > 90*time.Second || time.Until(stamp) > 20*time.Second || (out.Frontier != nil && (time.Now().Unix()-out.Frontier.Timestamp > 90 || out.Frontier.Timestamp-time.Now().Unix() > 20))) && out.Status == "ready" {
			out.Status = "stale"
		}
	}
	if r.Method != http.MethodHead {
		json.NewEncoder(w).Encode(out)
	}
}
