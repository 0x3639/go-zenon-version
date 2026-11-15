package main

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/zenon-network/go-zenon/common/types"
)

const defaultProductionSince = "2026-11-15T15:49:00Z"
const productionPageSize uint64 = 100
const productionPagesPerPass = 5

type productionRPC func(context.Context, string, string, any, ...any) error

type productionState struct {
	Since       string           `json:"since"`
	GeneratedAt string           `json:"generatedAt"`
	Source      string           `json:"source"`
	Anchor      *momentumHeader  `json:"anchor"`
	Last        *momentumHeader  `json:"last"`
	Frontier    *momentumHeader  `json:"frontier"`
	Registry    []schedulePillar `json:"registry"`
}
type productionPillar struct {
	Producer      string  `json:"producer"`
	Name          string  `json:"name"`
	Registered    bool    `json:"registered"`
	Count         uint64  `json:"count"`
	LastHeight    *uint64 `json:"lastHeight"`
	LastTimestamp *int64  `json:"lastTimestamp"`
}
type productionMomentum struct {
	momentumHeader
	IntervalSeconds int64 `json:"intervalSeconds"`
}
type productionIntervals struct {
	Samples         uint64   `json:"samples"`
	AverageSeconds  *float64 `json:"averageSeconds"`
	ShortestSeconds *int64   `json:"shortestSeconds"`
	LongestSeconds  *int64   `json:"longestSeconds"`
	LatestSeconds   *int64   `json:"latestSeconds"`
}
type productionSnapshot struct {
	SchemaVersion  int                  `json:"schemaVersion"`
	GeneratedAt    string               `json:"generatedAt"`
	Since          string               `json:"since"`
	Status         string               `json:"status"`
	Source         string               `json:"source"`
	Error          string               `json:"error,omitempty"`
	Complete       bool                 `json:"complete"`
	FirstHeight    *uint64              `json:"firstHeight"`
	Last           *momentumHeader      `json:"last"`
	Frontier       *momentumHeader      `json:"frontier"`
	TotalMomentums uint64               `json:"totalMomentums"`
	Remaining      uint64               `json:"remaining"`
	Pillars        []productionPillar   `json:"pillars"`
	Intervals      productionIntervals  `json:"intervals"`
	Recent         []productionMomentum `json:"recent"`
}
type productionStore struct {
	db       *sql.DB
	since    time.Time
	state    productionState // worker-owned; HTTP reads only the published snapshot
	rpc      productionRPC
	mu       sync.RWMutex
	snapshot productionSnapshot
	gaps     gapStudy
}

func productionSince(raw string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil || t.Unix() <= genesisUnix || t.Nanosecond() != 0 {
		return time.Time{}, errors.New("PRODUCTION_SINCE must be an RFC3339 time after mainnet genesis, with whole seconds")
	}
	return t.UTC(), nil
}
func openProduction(path, since string) (*productionStore, error) {
	start, err := productionSince(since)
	if err != nil {
		return nil, err
	}
	u := url.URL{Scheme: "file", Path: filepath.ToSlash(path)}
	db, err := sql.Open("sqlite3", u.String()+"?_journal_mode=WAL&_busy_timeout=3000&_synchronous=FULL")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	p := &productionStore{db: db, since: start, rpc: seedRPC, state: productionState{Since: start.Format(time.RFC3339)}}
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS production_state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS momentums (height INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, previous_hash TEXT NOT NULL, timestamp INTEGER NOT NULL, producer TEXT NOT NULL, interval_seconds INTEGER NOT NULL CHECK(interval_seconds>0));
 CREATE TABLE IF NOT EXISTS producers (producer TEXT PRIMARY KEY, count INTEGER NOT NULL, last_height INTEGER NOT NULL, last_timestamp INTEGER NOT NULL, total_seconds INTEGER NOT NULL, shortest INTEGER NOT NULL, longest INTEGER NOT NULL);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	var raw string
	err = db.QueryRow("SELECT value FROM production_state WHERE id=1").Scan(&raw)
	if err == nil {
		err = json.Unmarshal([]byte(raw), &p.state)
	}
	if err != nil && err != sql.ErrNoRows {
		db.Close()
		return nil, err
	}
	if p.state.Since != start.Format(time.RFC3339) {
		if err = p.reset(context.Background()); err != nil {
			db.Close()
			return nil, err
		}
	}
	if err = p.publish(context.Background(), "stale", "Waiting to recheck saved history against a public node."); err != nil {
		db.Close()
		return nil, err
	}
	return p, nil
}
func saveProductionState(ctx context.Context, tx *sql.Tx, s productionState) error {
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO production_state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", string(raw))
	return err
}
func (p *productionStore) reset(ctx context.Context) error {
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "DELETE FROM momentums; DELETE FROM producers;"); err != nil {
		return err
	}
	s := productionState{Since: p.since.Format(time.RFC3339)}
	if err = saveProductionState(ctx, tx, s); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	p.state = s
	return p.publish(ctx, "backfilling", "Chain history changed; rebuilding counts from the configured start time.")
}
func validateProductionHeader(m momentumHeader, at time.Time) error {
	h, e := hex.DecodeString(m.Hash)
	prev, pe := hex.DecodeString(m.PreviousHash)
	_, ae := types.ParseAddress(m.Producer)
	if m.Height == 0 || m.Height > 9007199254740991 || e != nil || len(h) != 32 || pe != nil || len(prev) != 32 || ae != nil || m.ChainIdentifier != 1 || m.Timestamp < genesisUnix || (m.Timestamp-genesisUnix)%slotSeconds != 0 || m.Timestamp > at.Unix()+20 {
		return errors.New("invalid mainnet momentum header")
	}
	return nil
}
func (p *productionStore) header(ctx context.Context, source string, height uint64, at time.Time) (momentumHeader, error) {
	var result struct {
		List []momentumHeader `json:"list"`
	}
	err := p.rpc(ctx, source, "ledger.getMomentumsByHeight", &result, height, 1)
	if err != nil {
		return momentumHeader{}, err
	}
	if len(result.List) != 1 || result.List[0].Height != height {
		return momentumHeader{}, errors.New("missing momentum header")
	}
	return result.List[0], validateProductionHeader(result.List[0], at)
}

// Find the last header before the inclusive timestamp boundary. Keep it as an
// anchor so even the first included momentum has a measured preceding interval.
func (p *productionStore) findAnchor(ctx context.Context, source string, frontier momentumHeader, at time.Time) (momentumHeader, error) {
	if frontier.Timestamp < p.since.Unix() {
		return frontier, nil
	}
	lo, hi := uint64(1), frontier.Height
	for lo < hi {
		mid := lo + (hi-lo)/2
		m, err := p.header(ctx, source, mid, at)
		if err != nil {
			return momentumHeader{}, err
		}
		if m.Timestamp < p.since.Unix() {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	if lo <= 1 {
		return momentumHeader{}, errors.New("production start must follow genesis")
	}
	anchor, err := p.header(ctx, source, lo-1, at)
	if err == nil && anchor.Timestamp >= p.since.Unix() {
		err = errors.New("inconsistent timestamp boundary")
	}
	return anchor, err
}
func (p *productionStore) append(ctx context.Context, next productionState, batch []momentumHeader) error {
	prev := next.Last
	if prev == nil {
		prev = next.Anchor
	}
	if prev == nil {
		return errors.New("missing history anchor")
	}
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, m := range batch {
		if m.Height != prev.Height+1 || m.PreviousHash != prev.Hash || m.Timestamp <= prev.Timestamp || m.Timestamp < p.since.Unix() {
			return errors.New("momentum history is not contiguous")
		}
		interval := m.Timestamp - prev.Timestamp
		if _, err = tx.ExecContext(ctx, `INSERT INTO momentums VALUES(?,?,?,?,?,?)`, m.Height, m.Hash, m.PreviousHash, m.Timestamp, m.Producer, interval); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO producers VALUES(?,1,?,?,?,?,?) ON CONFLICT(producer) DO UPDATE SET count=count+1,last_height=excluded.last_height,last_timestamp=excluded.last_timestamp,total_seconds=total_seconds+excluded.total_seconds,shortest=min(shortest,excluded.shortest),longest=max(longest,excluded.longest)`, m.Producer, m.Height, m.Timestamp, interval, interval, interval); err != nil {
			return err
		}
		copy := m
		prev = &copy
		next.Last = &copy
	}
	if err = saveProductionState(ctx, tx, next); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	p.state = next
	return nil
}
func (p *productionStore) syncSource(ctx context.Context, source string, at time.Time) error {
	var frontier momentumHeader
	if err := p.rpc(ctx, source, "ledger.getFrontierMomentum", &frontier); err != nil {
		return err
	}
	if err := validateProductionHeader(frontier, at); err != nil {
		return err
	}
	// Do not replace a checked history with a lagging or abandoned fork.
	if at.Unix()-frontier.Timestamp > 90 {
		return errors.New("public node's latest momentum is more than 90 seconds old")
	}
	checkpoint := p.state.Last
	if checkpoint == nil {
		checkpoint = p.state.Anchor
	}
	if checkpoint != nil {
		if frontier.Height < checkpoint.Height {
			return errors.New("public node is behind the saved history")
		}
		actual, err := p.header(ctx, source, checkpoint.Height, at)
		if err != nil {
			return err
		}
		if actual.Hash != checkpoint.Hash {
			if source != p.state.Source {
				return errors.New("fallback node disagrees with saved chain history")
			}
			if err = p.reset(ctx); err != nil {
				return err
			}
		}
	}
	next := p.state
	if next.Last == nil {
		anchor, err := p.findAnchor(ctx, source, frontier, at)
		if err != nil {
			return err
		}
		next.Anchor = &anchor
	}
	var registry struct {
		Count int              `json:"count"`
		List  []schedulePillar `json:"list"`
	}
	if err := p.rpc(ctx, source, "embedded.pillar.getAll", &registry, 0, 1000); err != nil {
		return err
	}
	if len(registry.List) == 0 || len(registry.List) > 1000 || registry.Count != len(registry.List) {
		return errors.New("incomplete pillar registry")
	}
	seen := map[string]bool{}
	for _, r := range registry.List {
		_, err := types.ParseAddress(r.Producer)
		if err != nil || len(r.Name) == 0 || len(r.Name) > 128 || seen[r.Producer] {
			return errors.New("invalid pillar registry")
		}
		seen[r.Producer] = true
	}
	next.Registry = registry.List
	next.Source = source
	next.Frontier = &frontier
	last := next.Last
	if last == nil {
		last = next.Anchor
	}
	for page := 0; page < productionPagesPerPass; page++ {
		count := min(productionPageSize, frontier.Height-last.Height)
		batch := []momentumHeader{}
		if count > 0 {
			var response struct {
				List []momentumHeader `json:"list"`
			}
			if err := p.rpc(ctx, source, "ledger.getMomentumsByHeight", &response, last.Height+1, count); err != nil {
				return err
			}
			if uint64(len(response.List)) != count {
				return errors.New("incomplete momentum history page")
			}
			batch = response.List
			for _, m := range batch {
				if err := validateProductionHeader(m, at); err != nil {
					return err
				}
			}
			end := batch[len(batch)-1]
			if end.Height == frontier.Height && end.Hash != frontier.Hash {
				return errors.New("frontier changed while reading history")
			}
		}
		// Recheck the pinned tip after reading, before making counts visible.
		tip, err := p.header(ctx, source, frontier.Height, at)
		if err != nil {
			return err
		}
		if tip.Hash != frontier.Hash {
			return errors.New("chain changed while reading history")
		}
		next.GeneratedAt = at.UTC().Format(time.RFC3339)
		if err = p.append(ctx, next, batch); err != nil {
			return err
		}
		next = p.state
		last = next.Last
		if last == nil {
			last = next.Anchor
		}
		if err = p.publish(ctx, "", ""); err != nil {
			return err
		}
		if last.Height == frontier.Height {
			break
		}
	}
	return nil
}

func (p *productionStore) publish(ctx context.Context, status, message string) error {
	s := p.state
	out := productionSnapshot{SchemaVersion: 1, Since: s.Since, GeneratedAt: s.GeneratedAt, Source: s.Source, Last: s.Last, Frontier: s.Frontier, Pillars: []productionPillar{}, Recent: []productionMomentum{}}
	byAddress := map[string]productionPillar{}
	for _, r := range s.Registry {
		byAddress[r.Producer] = productionPillar{Producer: r.Producer, Name: r.Name, Registered: true}
	}
	rows, err := p.db.QueryContext(ctx, "SELECT producer,count,last_height,last_timestamp,total_seconds,shortest,longest FROM producers")
	if err != nil {
		return err
	}
	var totalSeconds int64
	for rows.Next() {
		var address string
		var count, height uint64
		var stamp, sum, short, long int64
		if err = rows.Scan(&address, &count, &height, &stamp, &sum, &short, &long); err != nil {
			rows.Close()
			return err
		}
		row := byAddress[address]
		row.Producer = address
		row.Count = count
		row.LastHeight = &height
		row.LastTimestamp = &stamp
		byAddress[address] = row
		out.TotalMomentums += count
		totalSeconds += sum
		if out.Intervals.ShortestSeconds == nil || short < *out.Intervals.ShortestSeconds {
			v := short
			out.Intervals.ShortestSeconds = &v
		}
		if out.Intervals.LongestSeconds == nil || long > *out.Intervals.LongestSeconds {
			v := long
			out.Intervals.LongestSeconds = &v
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, r := range byAddress {
		out.Pillars = append(out.Pillars, r)
	}
	sort.Slice(out.Pillars, func(i, j int) bool {
		a, b := out.Pillars[i], out.Pillars[j]
		if a.Count != b.Count {
			return a.Count > b.Count
		}
		return a.Producer < b.Producer
	})
	out.Intervals.Samples = out.TotalMomentums
	if out.TotalMomentums > 0 {
		v := float64(totalSeconds) / float64(out.TotalMomentums)
		out.Intervals.AverageSeconds = &v
		first := s.Anchor.Height + 1
		out.FirstHeight = &first
	}
	if s.Frontier != nil && s.Anchor != nil {
		last := s.Anchor
		if s.Last != nil {
			last = s.Last
		}
		out.Remaining = s.Frontier.Height - last.Height
		out.Complete = out.Remaining == 0
	}
	if s.Last != nil {
		out.Recent, err = readProductionRows(ctx, p.db, s.Last.Height+1, 25)
		if err != nil {
			return err
		}
		if len(out.Recent) > 0 {
			v := out.Recent[0].IntervalSeconds
			out.Intervals.LatestSeconds = &v
		}
	}
	if status == "" {
		status = "backfilling"
		message = ""
		if out.Complete {
			status = "ready"
		}
	}
	if s.GeneratedAt == "" && status == "stale" {
		status = "unavailable"
		message = "Reading chain history for the first time."
	}
	out.Status = status
	out.Error = message
	p.mu.Lock()
	p.snapshot = out
	p.mu.Unlock()
	p.updateGapStudy(ctx, out)
	return nil
}

type productionQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func readProductionRows(ctx context.Context, db productionQuerier, before uint64, limit int) ([]productionMomentum, error) {
	rows, err := db.QueryContext(ctx, "SELECT height,hash,previous_hash,timestamp,producer,interval_seconds FROM momentums WHERE height<? ORDER BY height DESC LIMIT ?", before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []productionMomentum{}
	for rows.Next() {
		var m productionMomentum
		m.ChainIdentifier = 1
		if err = rows.Scan(&m.Height, &m.Hash, &m.PreviousHash, &m.Timestamp, &m.Producer, &m.IntervalSeconds); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
func (p *productionStore) failure(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.gaps.Status = "unavailable"
	p.gaps.Error = "Production history could not refresh; study results are historical."
	p.snapshot.Status = "unavailable"
	p.snapshot.Error = "Chain history could not refresh. Saved counts retain their original timestamp."
	log.Printf("production history: %v", err)
}
func (p *productionStore) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if p == nil {
		http.Error(w, `{"error":"production history unavailable"}`, 503)
		return
	}
	p.mu.RLock()
	value := p.snapshot
	p.mu.RUnlock()
	if value.GeneratedAt != "" {
		t, _ := time.Parse(time.RFC3339, value.GeneratedAt)
		if time.Since(t) > 90*time.Second && value.Status != "unavailable" {
			value.Status = "stale"
		}
	}
	if r.Method != http.MethodHead {
		json.NewEncoder(w).Encode(value)
	}
}
func (p *productionStore) serveHistory(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if p == nil {
		http.Error(w, `{"error":"production history unavailable"}`, 503)
		return
	}
	q := r.URL.Query()
	tip, te := strconv.ParseUint(q.Get("tipHeight"), 10, 53)
	before, be := strconv.ParseUint(q.Get("beforeHeight"), 10, 53)
	limit, le := strconv.Atoi(q.Get("limit"))
	hash := q.Get("tipHash")
	if te != nil || be != nil || le != nil || tip == 0 || before == 0 || before > tip+1 || limit < 1 || limit > 100 || len(hash) != 64 {
		http.Error(w, `{"error":"require tipHeight, tipHash, beforeHeight and limit (1..100)"}`, 400)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	tx, err := p.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		http.Error(w, `{"error":"history unavailable"}`, 503)
		return
	}
	defer tx.Rollback()
	var actual string
	if err = tx.QueryRowContext(ctx, "SELECT hash FROM momentums WHERE height=?", tip).Scan(&actual); err != nil || actual != hash {
		http.Error(w, `{"error":"history changed; return to latest before paging"}`, 409)
		return
	}
	rows, err := readProductionRows(ctx, tx, before, limit+1)
	if err != nil {
		http.Error(w, `{"error":"history unavailable"}`, 503)
		return
	}
	var next *uint64
	if len(rows) > limit {
		rows = rows[:limit]
		v := rows[len(rows)-1].Height
		next = &v
	}
	if r.Method != http.MethodHead {
		json.NewEncoder(w).Encode(struct {
			SchemaVersion int                  `json:"schemaVersion"`
			TipHeight     uint64               `json:"tipHeight"`
			TipHash       string               `json:"tipHash"`
			Data          []productionMomentum `json:"data"`
			Next          *uint64              `json:"nextBeforeHeight"`
		}{1, tip, hash, rows, next})
	}
}

// Initial timestamp lookup needs about 24 sequential probes at current mainnet
// height. Allow that bounded search to finish on slower sources; seedRPC still
// bounds each individual call. Once a checkpoint exists, use the shorter budget.
func (p *productionStore) syncAttempt(ctx context.Context, source string, at time.Time) error {
	budget := 45 * time.Second
	if p.state.Last == nil {
		budget = 5 * time.Minute
	}
	attempt, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	return p.syncSource(attempt, source, at)
}

func (p *productionStore) run(ctx context.Context, seeds []string) {
	preferred := 0
	for i, seed := range seeds {
		if seed == p.state.Source {
			preferred = i
		}
	}
	for {
		var lastErr error
		for i := 0; i < len(seeds); i++ {
			index := (preferred + i) % len(seeds)
			lastErr = p.syncAttempt(ctx, seeds[index], time.Now())
			if lastErr == nil {
				preferred = index
				break
			}
			if ctx.Err() != nil {
				return
			}
		}
		if lastErr != nil {
			p.failure(lastErr)
		}
		delay := 30 * time.Second
		p.mu.RLock()
		if lastErr == nil && !p.snapshot.Complete {
			delay = 5 * time.Second
		}
		p.mu.RUnlock()
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
	}
}
