package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/zenon-network/go-zenon/common/types"
	"github.com/zenon-network/go-zenon/consensus"
)

// Mainnet genesis, checked against ledger.getMomentumsByHeight(1, 1).
// Slot timing and election rules are pinned by the go-zenon dependency.
const genesisUnix int64 = 1637755200
const slotSeconds int64 = 10
const roundSeconds int64 = 300

type momentumHeader struct {
	Height          uint64 `json:"height"`
	Hash            string `json:"hash"`
	PreviousHash    string `json:"previousHash"`
	Timestamp       int64  `json:"timestamp"`
	Producer        string `json:"producer"`
	ChainIdentifier uint64 `json:"chainIdentifier"`
}
type schedulePillar struct {
	Name     string `json:"name"`
	Producer string `json:"producerAddress"`
	Weight   string `json:"weight"`
}
type pillarVersion struct {
	Version          *string  `json:"version"`
	PeerID           string   `json:"peerId,omitempty"`
	Evidence         string   `json:"evidence,omitempty"`
	ObservedAt       string   `json:"observedAt,omitempty"`
	ReportedVersions []string `json:"reportedVersions,omitempty"`
	Reason           string   `json:"reason"`
}
type momentumSlot struct {
	Round    uint64          `json:"round"`
	Index    int             `json:"index"`
	StartsAt int64           `json:"startsAt"`
	Pillar   string          `json:"pillar"`
	Producer string          `json:"producer"`
	Version  pillarVersion   `json:"software"`
	Observed *momentumHeader `json:"observed,omitempty"`
}
type scheduleRound struct {
	Round       uint64 `json:"round"`
	ProofHeight uint64 `json:"proofHeight"`
	ProofHash   string `json:"proofHash"`
	ProofCutoff int64  `json:"proofCutoff"`
	Checked     int    `json:"checked"`
	Matched     int    `json:"matched"`
}
type momentumSchedule struct {
	SchemaVersion int             `json:"schemaVersion"`
	GeneratedAt   string          `json:"generatedAt"`
	Status        string          `json:"status"`
	Source        string          `json:"source"`
	Basis         string          `json:"basis"`
	Error         string          `json:"error,omitempty"`
	Genesis       int64           `json:"genesis"`
	SlotSeconds   int64           `json:"slotSeconds"`
	Frontier      *momentumHeader `json:"frontier"`
	Checked       int             `json:"checked"`
	Matched       int             `json:"matched"`
	Rounds        []scheduleRound `json:"rounds"`
	Slots         []momentumSlot  `json:"slots"`
}

func emptySchedule() momentumSchedule {
	return momentumSchedule{SchemaVersion: 1, Status: "unavailable", Basis: "rpc-current-weights", Genesis: genesisUnix, SlotSeconds: slotSeconds, Rounds: []scheduleRound{}, Slots: []momentumSlot{}}
}

// An operator-supplied public-key link is an assertion, not a cryptographic
// binding between the Ed25519 producer key and the separate secp256k1 P2P key.
func parsePillarPeers(raw string) (map[string]string, error) {
	result := map[string]string{}
	if raw == "" {
		return result, nil
	}
	if len(raw) > 500000 || json.Unmarshal([]byte(raw), &result) != nil || len(result) > 1000 {
		return nil, errors.New("invalid PILLAR_PEERS_JSON")
	}
	for address, peer := range result {
		if _, err := types.ParseAddress(address); err != nil || !validID(peer) {
			return nil, errors.New("PILLAR_PEERS_JSON requires producing-address to peer-public-key entries")
		}
		result[address] = strings.ToLower(peer)
	}
	return result, nil
}
func linkedVersion(producer string, links map[string]string, nodes map[string]Node, at time.Time) pillarVersion {
	result := pillarVersion{Reason: "no-pillar-peer-link"}
	peer := links[producer]
	if peer == "" {
		return result
	}
	result.PeerID = peer
	n, ok := nodes[peer]
	if !ok {
		result.Reason = "linked-peer-not-observed"
		return result
	}
	stamp, err := time.Parse(time.RFC3339, n.LastSeen)
	result.ObservedAt = n.LastSeen
	if err != nil || at.Sub(stamp) > time.Hour || stamp.After(at.Add(time.Minute)) {
		result.Reason = "linked-observation-stale"
		return result
	}
	result.Evidence = n.Evidence
	result.Version = n.Version
	result.ReportedVersions = n.ReportedVersions
	result.Reason = "configured-peer-link"
	if n.Version == nil {
		result.Reason = "linked-peer-version-unknown"
	}
	return result
}

func buildSchedule(at time.Time, source string, frontier momentumHeader, recent []momentumHeader, pillars []schedulePillar, nodes []Node, links map[string]string) (momentumSchedule, error) {
	out := emptySchedule()
	if frontier.ChainIdentifier != 1 || frontier.Height < 181 || frontier.Timestamp < genesisUnix || frontier.Timestamp > at.Unix()+20 {
		return out, errors.New("invalid mainnet frontier")
	}
	if len(recent) != 180 || len(pillars) == 0 || len(pillars) > 1000 {
		return out, errors.New("incomplete schedule inputs")
	}
	sort.Slice(recent, func(i, j int) bool { return recent[i].Height < recent[j].Height })
	for i, m := range recent {
		if m.ChainIdentifier != 1 || len(m.Hash) != 64 || m.Timestamp < genesisUnix || (m.Timestamp-genesisUnix)%slotSeconds != 0 {
			return out, errors.New("invalid momentum header")
		}
		if _, err := types.ParseAddress(m.Producer); err != nil {
			return out, errors.New("invalid producer address")
		}
		if i > 0 && (m.Height != recent[i-1].Height+1 || m.PreviousHash != recent[i-1].Hash || m.Timestamp <= recent[i-1].Timestamp) {
			return out, errors.New("recent momentum history is inconsistent")
		}
	}
	last := recent[len(recent)-1]
	if last.Hash != frontier.Hash || last.Height != frontier.Height || last.Timestamp != frontier.Timestamp {
		return out, errors.New("frontier changed while reading history")
	}
	delegations := make([]*types.PillarDelegation, 0, len(pillars))
	names, addresses := map[string]bool{}, map[string]bool{}
	for _, p := range pillars {
		address, err := types.ParseAddress(p.Producer)
		weight, ok := new(big.Int).SetString(p.Weight, 10)
		if err != nil || !ok || weight.Sign() < 0 || weight.BitLen() > 256 || len(p.Name) == 0 || len(p.Name) > 128 || names[p.Name] || addresses[p.Producer] {
			return out, errors.New("invalid or duplicate pillar data")
		}
		names[p.Name], addresses[p.Producer] = true, true
		delegations = append(delegations, &types.PillarDelegation{Name: p.Name, Producing: address, Weight: weight})
	}
	out.GeneratedAt = at.UTC().Format(time.RFC3339)
	out.Source = source
	out.Frontier = &frontier
	out.Status = "ready"
	if at.Unix()-frontier.Timestamp > 90 {
		out.Status = "stale"
		out.Error = "The public node's latest momentum is more than 90 seconds old."
	}
	byID := map[string]Node{}
	for _, n := range nodes {
		byID[n.ID] = n
	}
	observed := map[int64]momentumHeader{}
	for _, m := range recent {
		observed[m.Timestamp] = m
	}
	current := uint64((at.Unix() - genesisUnix) / roundSeconds)
	first := uint64((recent[0].Timestamp - genesisUnix) / roundSeconds)
	// Do not walk an unbounded number of rounds when an RPC node is stale.
	if current > first+8 {
		first = current - 8
	}
	algorithm := consensus.NewElectionAlgorithm(consensus.NewConsensusContext(time.Unix(genesisUnix, 0)))
	for tick := first; tick <= current+1; tick++ {
		if tick < 2 {
			continue
		}
		cutoff := genesisUnix + int64(tick-1)*roundSeconds
		// A later observed momentum establishes that the proof cutoff has passed.
		if frontier.Timestamp < cutoff {
			continue
		}
		var proof *momentumHeader
		for i := range recent {
			if recent[i].Timestamp < cutoff {
				proof = &recent[i]
			}
		}
		if proof == nil {
			continue
		}
		rawHash, err := hex.DecodeString(proof.Hash)
		if err != nil {
			return out, err
		}
		var hash types.Hash
		copy(hash[:], rawHash)
		copyDelegations := append([]*types.PillarDelegation(nil), delegations...)
		producers := algorithm.SelectProducers(consensus.NewAlgorithmContext(copyDelegations, &types.HashHeight{Height: proof.Height, Hash: hash}))
		if len(producers) != 30 {
			return out, errors.New("unexpected election size")
		}
		round := scheduleRound{Round: tick, ProofHeight: proof.Height, ProofHash: proof.Hash, ProofCutoff: cutoff}
		for i, p := range producers {
			start := genesisUnix + int64(tick)*roundSeconds + int64(i)*slotSeconds
			slot := momentumSlot{Round: tick, Index: i + 1, StartsAt: start, Pillar: p.Name, Producer: p.Producing.String(), Version: linkedVersion(p.Producing.String(), links, byID, at)}
			if m, ok := observed[start]; ok {
				slot.Observed = &m
				round.Checked++
				if m.Producer == slot.Producer {
					round.Matched++
				}
			}
			if tick+1 >= current {
				out.Slots = append(out.Slots, slot)
			}
		}
		out.Checked += round.Checked
		out.Matched += round.Matched
		out.Rounds = append(out.Rounds, round)
	}
	return out, nil
}

type scheduleStore struct {
	mu    sync.RWMutex
	value momentumSchedule
	body  []byte
	etag  string
}

func (s *scheduleStore) publish(value momentumSchedule) {
	body, _ := json.Marshal(value)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.value = value
	s.body = body
	s.etag = fmt.Sprintf(`"%x"`, sha256.Sum256(body))
}
func (s *scheduleStore) failure(err error) {
	s.mu.RLock()
	value := s.value
	s.mu.RUnlock()
	if value.SchemaVersion == 0 {
		value = emptySchedule()
	}
	value.Status = "unavailable"
	value.Error = bounded(err.Error(), 200)
	// Retain the last success timestamp, never make old observations look fresh.
	s.publish(value)
}
func (s *scheduleStore) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=5")
	if s == nil {
		w.WriteHeader(503)
		if r.Method != http.MethodHead {
			json.NewEncoder(w).Encode(emptySchedule())
		}
		return
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	w.Header().Set("ETag", s.etag)
	if s.value.Status == "unavailable" {
		w.WriteHeader(503)
	} else if r.Header.Get("If-None-Match") == s.etag {
		w.WriteHeader(304)
		return
	}
	if r.Method != http.MethodHead {
		w.Write(s.body)
	}
}

func fetchSchedule(ctx context.Context, source string, at time.Time, nodes []Node, links map[string]string) (momentumSchedule, error) {
	var frontier momentumHeader
	if err := seedRPC(ctx, source, "ledger.getFrontierMomentum", &frontier); err != nil {
		return emptySchedule(), err
	}
	if frontier.Height < 181 {
		return emptySchedule(), errors.New("mainnet history unavailable")
	}
	var recent struct {
		List []momentumHeader `json:"list"`
	}
	var pillars struct {
		Count int              `json:"count"`
		List  []schedulePillar `json:"list"`
	}
	var errRecent, errPillars error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		errRecent = seedRPC(ctx, source, "ledger.getMomentumsByHeight", &recent, frontier.Height-179, 180)
	}()
	go func() {
		defer wg.Done()
		errPillars = seedRPC(ctx, source, "embedded.pillar.getAll", &pillars, 0, 1000)
	}()
	wg.Wait()
	if errRecent != nil {
		return emptySchedule(), errRecent
	}
	if errPillars != nil {
		return emptySchedule(), errPillars
	}
	if pillars.Count != len(pillars.List) {
		return emptySchedule(), errors.New("pillar list was truncated")
	}
	return buildSchedule(at, source, frontier, recent.List, pillars.List, nodes, links)
}
func runSchedule(ctx context.Context, c config, data *store, links map[string]string) {
	preferred := 0
	for {
		var lastErr error
		for i := 0; i < len(c.seeds); i++ {
			index := (preferred + i) % len(c.seeds)
			attempt, cancel := context.WithTimeout(ctx, 8*time.Second)
			value, err := fetchSchedule(attempt, c.seeds[index], time.Now(), data.current().Nodes, links)
			cancel()
			if err == nil {
				data.schedule.publish(value)
				preferred = index
				lastErr = nil
				break
			}
			lastErr = err
			if ctx.Err() != nil {
				return
			}
		}
		if lastErr != nil {
			data.schedule.failure(lastErr)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Second):
		}
	}
}
