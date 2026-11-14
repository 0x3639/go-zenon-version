package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type rpcPeer struct {
	PublicKey string `json:"publicKey"`
	IP        string `json:"ip"`
	Name      string `json:"name"`
}
type rpcNetwork struct {
	Peers []rpcPeer `json:"peers"`
	Self  rpcPeer   `json:"self"`
}
type rpcProcess struct {
	Version string `json:"version"`
	Commit  string `json:"commit"`
}

func seedRPC(ctx context.Context, address, method string, target any, args ...any) error {
	u, err := url.Parse(address)
	if err != nil || (u.Scheme != "wss" && u.Scheme != "https") || u.User != nil {
		return errors.New("seed requires wss:// or https://")
	}
	if args == nil {
		args = []any{}
	}
	request := map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": args}
	var raw []byte
	if u.Scheme == "wss" {
		dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
		conn, _, e := dialer.DialContext(ctx, address, nil)
		if e != nil {
			return e
		}
		defer conn.Close()
		stop := context.AfterFunc(ctx, func() { conn.Close() })
		defer stop()
		conn.SetReadLimit(2_000_000)
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if e = conn.WriteJSON(request); e != nil {
			return e
		}
		_, raw, err = conn.ReadMessage()
	} else {
		body, _ := json.Marshal(request)
		req, e := http.NewRequestWithContext(ctx, http.MethodPost, address, strings.NewReader(string(body)))
		if e != nil {
			return e
		}
		req.Header.Set("Content-Type", "application/json")
		client := &http.Client{Timeout: 6 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect refused") }}
		response, e := client.Do(req)
		if e != nil {
			return e
		}
		defer response.Body.Close()
		if response.StatusCode != 200 {
			return fmt.Errorf("HTTP %d", response.StatusCode)
		}
		raw, err = io.ReadAll(io.LimitReader(response.Body, 2_000_001))
	}
	if err != nil {
		return err
	}
	if len(raw) > 2_000_000 {
		return errors.New("response too large")
	}
	var envelope struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      int             `json:"id"`
		Result  json.RawMessage `json:"result"`
		Error   *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err = json.Unmarshal(raw, &envelope); err != nil {
		return err
	}
	if envelope.JSONRPC != "2.0" || envelope.ID != 1 {
		return errors.New("invalid RPC envelope")
	}
	if envelope.Error != nil {
		return errors.New(bounded(envelope.Error.Message, 300))
	}
	return json.Unmarshal(envelope.Result, target)
}
func readSeed(ctx context.Context, address string) ([]Node, Source) {
	source := Source{Endpoint: address, Status: "error", CheckedAt: now()}
	var network rpcNetwork
	if err := seedRPC(ctx, address, "stats.networkInfo", &network); err != nil {
		source.Error = bounded(err.Error(), 300)
		return nil, source
	}
	if network.Peers == nil || len(network.Peers) > 5000 {
		source.Error = "invalid peer list"
		return nil, source
	}
	nodes := []Node{}
	for _, peer := range network.Peers {
		if validID(peer.PublicKey) && publicIP(peer.IP) {
			nodes = append(nodes, newNode(peer.PublicKey, peer.IP, peer.Name, address, "peer"))
		}
	}
	if validID(network.Self.PublicKey) {
		u, _ := url.Parse(address)
		host := u.Hostname()
		ips, _ := net.DefaultResolver.LookupIP(ctx, "ip", host)
		for _, ip := range ips {
			if ip.To4() != nil && publicIP(ip.String()) {
				host = ip.String()
				break
			}
		}
		n := newNode(network.Self.PublicKey, host, "", address, "peer")
		n.RPCEndpoints = []string{address}
		var process rpcProcess
		if seedRPC(ctx, address, "stats.processInfo", &process) == nil {
			n.Name = bounded(process.Version+" znn-node", 512)
			n.Version = version(process.Version)
			n.Evidence = "rpc"
			n.Commit = &process.Commit
			if n.Version != nil {
				n.ReportedVersions = []string{*n.Version}
			}
		}
		nodes = append(nodes, n)
		id := n.ID
		source.NodeID = &id
	}
	source.Status = "ok"
	source.PeerCount = len(network.Peers)
	source.CheckedAt = now()
	return nodes, source
}

const releaseAPI = "https://api.github.com/repos/zenon-network/go-zenon-releases/releases/latest"
const releaseTagURL = "https://github.com/zenon-network/go-zenon-releases/releases/tag/"

func releaseNeedsRefresh(release *Release, at time.Time) bool {
	// A deployment changing the source must not retain a fresh cache from the old repository.
	if release == nil || !strings.HasPrefix(release.URL, releaseTagURL) {
		return true
	}
	checked, err := time.Parse(time.RFC3339, release.CheckedAt)
	return err != nil || at.Before(checked) || at.Sub(checked) >= 24*time.Hour
}

func latestRelease(ctx context.Context) *Release {
	return fetchLatestRelease(ctx, &http.Client{Timeout: 8 * time.Second})
}

func fetchLatestRelease(ctx context.Context, client *http.Client) *Release {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, releaseAPI, nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	response, err := client.Do(req)
	if err != nil {
		return nil
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil
	}
	var result struct {
		Name string `json:"name"`
		Tag  string `json:"tag_name"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1_000_000)).Decode(&result) != nil {
		return nil
	}
	v := version(result.Name)
	if v == nil {
		v = version(result.Tag)
	}
	if v == nil || result.Tag == "" {
		return nil
	}
	return &Release{*v, result.Tag, releaseTagURL + url.PathEscape(result.Tag), now()}
}
