package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strconv"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/rlp"
	"github.com/zenon-network/go-zenon/p2p"
	"github.com/zenon-network/go-zenon/p2p/discover"
)

// Zenon uses the discovery-v4 wire format. This small client only exchanges
// ping/pong/findnode/neighbors with the public peer explicitly being queried.
// It never answers findnode requests or accepts unsolicited neighbor lists.
type endpoint struct {
	IP  net.IP
	UDP uint16
	TCP uint16
}
type pingPacket struct {
	Version    uint
	From       endpoint
	To         endpoint
	Expiration uint64
}
type pongPacket struct {
	To         endpoint
	Token      []byte
	Expiration uint64
}
type findPacket struct {
	Target     [64]byte
	Expiration uint64
}
type wireNode struct {
	IP  net.IP
	UDP uint16
	TCP uint16
	ID  [64]byte
}
type neighborsPacket struct {
	Nodes      []wireNode
	Expiration uint64
}

func encodePacket(key *ecdsa.PrivateKey, kind byte, payload any) ([]byte, error) {
	data, err := rlp.EncodeToBytes(payload)
	if err != nil {
		return nil, err
	}
	packet := make([]byte, 98+len(data))
	packet[97] = kind
	copy(packet[98:], data)
	sig, err := crypto.Sign(crypto.Keccak256(packet[97:]), key)
	if err != nil {
		return nil, err
	}
	copy(packet[32:97], sig)
	copy(packet[:32], crypto.Keccak256(packet[32:]))
	return packet, nil
}
func decodePacket(data []byte, expected string) (byte, []byte, error) {
	if len(data) < 98 || len(data) > 1280 || !bytes.Equal(data[:32], crypto.Keccak256(data[32:])) {
		return 0, nil, errors.New("invalid discovery packet")
	}
	pub, err := crypto.SigToPub(crypto.Keccak256(data[97:]), data[32:97])
	if err != nil {
		return 0, nil, err
	}
	if hex.EncodeToString(crypto.FromECDSAPub(pub)[1:]) != expected {
		return 0, nil, errors.New("unexpected peer identity")
	}
	return data[97], data[98:], nil
}
func validExpiry(exp uint64) bool {
	t := time.Now().Unix()
	return exp >= uint64(t) && exp <= uint64(t+120)
}

func discoverNeighbors(ctx context.Context, key *ecdsa.PrivateKey, peer Node) ([]Node, error) {
	if !publicIP(peer.IP) || !validID(peer.ID) || peer.UDP < 1024 {
		return nil, errors.New("invalid public peer")
	}
	address := &net.UDPAddr{IP: net.ParseIP(peer.IP), Port: int(peer.UDP)}
	conn, err := net.DialUDP("udp", nil, address)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	local := conn.LocalAddr().(*net.UDPAddr)
	expiry := func() uint64 { return uint64(time.Now().Add(20 * time.Second).Unix()) }
	remote := endpoint{IP: address.IP, UDP: peer.UDP, TCP: peer.TCP}
	packet, err := encodePacket(key, 1, pingPacket{4, endpoint{local.IP, uint16(local.Port), 0}, remote, expiry()})
	if err != nil {
		return nil, err
	}
	if _, err = conn.Write(packet); err != nil {
		return nil, err
	}
	token := append([]byte{}, packet[:32]...)
	deadline := time.Now().Add(3 * time.Second)
	queryAt := time.Now().Add(750 * time.Millisecond)
	bonded, queried := false, false
	queries := 0
	nodes := []Node{}
	seen := map[string]bool{}
	for time.Now().Before(deadline) && ctx.Err() == nil {
		if bonded && queries < 3 && time.Now().After(queryAt) {
			var target [64]byte
			if _, err = rand.Read(target[:]); err != nil {
				return nil, err
			}
			query, e := encodePacket(key, 3, findPacket{target, expiry()})
			if e != nil {
				return nil, e
			}
			if _, e = conn.Write(query); e != nil {
				return nil, e
			}
			queried = true
			queries++
			queryAt = time.Now().Add(650 * time.Millisecond)
		}
		conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
		buffer := make([]byte, 1281)
		length, e := conn.Read(buffer)
		if e != nil {
			if timeout, ok := e.(net.Error); ok && timeout.Timeout() {
				continue
			}
			return nodes, e
		}
		data := buffer[:length]
		kind, payload, e := decodePacket(data, peer.ID)
		if e != nil {
			continue
		}
		switch kind {
		case 1:
			var ping pingPacket
			if rlp.DecodeBytes(payload, &ping) != nil || ping.Version != 4 || !validExpiry(ping.Expiration) {
				continue
			}
			pong, e := encodePacket(key, 2, pongPacket{remote, append([]byte{}, data[:32]...), expiry()})
			if e == nil {
				conn.Write(pong)
			}
		case 2:
			var pong pongPacket
			if rlp.DecodeBytes(payload, &pong) == nil && validExpiry(pong.Expiration) && bytes.Equal(pong.Token, token) {
				bonded = true
			}
		case 4:
			if !queried {
				continue
			}
			var neighbors neighborsPacket
			if rlp.DecodeBytes(payload, &neighbors) != nil || !validExpiry(neighbors.Expiration) {
				continue
			}
			for _, candidate := range neighbors.Nodes {
				id, ip := hex.EncodeToString(candidate.ID[:]), candidate.IP.String()
				if seen[id] || !publicIP(ip) || !validID(id) || candidate.UDP < 1024 || candidate.TCP < 1024 {
					continue
				}
				seen[id] = true
				n := newNode(id, ip, "", "discovery://"+net.JoinHostPort(peer.IP, strconv.Itoa(int(peer.UDP))), "discovery")
				n.TCP, n.UDP = candidate.TCP, candidate.UDP
				nodes = append(nodes, n)
				if len(nodes) >= 48 {
					return nodes, nil
				}
			}
		}
	}
	if !bonded {
		return nodes, errors.New("UDP discovery did not respond")
	}
	if !queried {
		return nodes, errors.New("discovery interrupted")
	}
	return nodes, nil
}

// Use the validator's own legacy RLPx implementation for wire compatibility.
// The eth/61 handler captures the authenticated hello name and then disconnects;
// it does not perform chain sync, announce blocks, sign votes, or send transactions.
func probeVersion(ctx context.Context, key *ecdsa.PrivateKey, node Node) (string, error) {
	if !publicIP(node.IP) || !validID(node.ID) || node.TCP < 1024 {
		return "", errors.New("invalid public peer")
	}
	remote, err := discover.ParseNode(fmt.Sprintf("enode://%s@%s", node.ID, net.JoinHostPort(node.IP, strconv.Itoa(int(node.TCP)))))
	if err != nil {
		return "", err
	}
	result := make(chan string, 1)
	server := &p2p.Server{PrivateKey: key, Name: "zenon-observatory/1.0", MaxPeers: 1, MaxPendingPeers: 1,
		Discovery: false, StaticNodes: []*discover.Node{remote}, Dialer: &net.Dialer{Timeout: 3 * time.Second},
		Protocols: []p2p.Protocol{{Name: "eth", Version: 61, Length: 9, Run: func(peer *p2p.Peer, _ p2p.MsgReadWriter) error {
			select {
			case result <- bounded(peer.Name(), 512):
			default:
			}
			return p2p.DiscQuitting
		}}},
	}
	if err = server.Start(); err != nil {
		return "", err
	}
	defer server.Stop()
	timer := time.NewTimer(7 * time.Second)
	defer timer.Stop()
	select {
	case name := <-result:
		return name, nil
	case <-timer.C:
		return "", errors.New("P2P handshake timed out or peer declined")
	case <-ctx.Done():
		return "", ctx.Err()
	}
}
