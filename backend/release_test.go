package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type releaseTransport func(*http.Request) (*http.Response, error)

func (f releaseTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestLatestReleaseUsesBinaryReleaseRepository(t *testing.T) {
	client := &http.Client{Transport: releaseTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != "https://api.github.com/repos/zenon-network/go-zenon-releases/releases/latest" {
			t.Fatalf("wrong release repository: %s", r.URL)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"name":"go-zenon v0.0.10","tag_name":"v0.0.10"}`))}, nil
	})}
	release := fetchLatestRelease(context.Background(), client)
	if release == nil || release.Version != "v0.0.10" || release.Tag != "v0.0.10" || release.URL != "https://github.com/zenon-network/go-zenon-releases/releases/tag/v0.0.10" {
		t.Fatalf("wrong release metadata: %#v", release)
	}
	if _, err := time.Parse(time.RFC3339, release.CheckedAt); err != nil {
		t.Fatal(err)
	}
}

func TestReleaseFailuresAndTagFallback(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		err        error
		want       string
	}{
		{"tag fallback", `{"name":"Binary release","tag_name":"v0.0.10"}`, 200, nil, "v0.0.10"},
		{"invalid JSON", `{`, 200, nil, ""},
		{"no version", `{"tag_name":"main"}`, 200, nil, ""},
		{"missing tag", `{"name":"go-zenon v0.0.10"}`, 200, nil, ""},
		{"rate limit", `{"message":"rate limited"}`, 403, nil, ""},
		{"unavailable", "", 0, errors.New("offline"), ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: releaseTransport(func(*http.Request) (*http.Response, error) {
				if tc.err != nil {
					return nil, tc.err
				}
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})}
			got := fetchLatestRelease(context.Background(), client)
			if tc.want == "" {
				if got != nil {
					t.Fatalf("expected failed lookup, got %#v", got)
				}
				return
			}
			if got == nil || got.Version != tc.want {
				t.Fatalf("got %#v, want %s", got, tc.want)
			}
		})
	}
}

func TestReleaseCacheMigratesRepositoryImmediately(t *testing.T) {
	at := time.Date(2026, 11, 14, 11, 0, 0, 0, time.UTC)
	currentURL := "https://github.com/zenon-network/go-zenon-releases/releases/tag/v0.0.10"
	for _, tc := range []struct {
		name    string
		release *Release
		refresh bool
	}{
		{"missing", nil, true},
		{"fresh old source", &Release{URL: "https://github.com/zenon-network/go-zenon/releases/tag/v0.0.9-alphanet", CheckedAt: at.Format(time.RFC3339)}, true},
		{"fresh current source", &Release{URL: currentURL, CheckedAt: at.Add(-time.Hour).Format(time.RFC3339)}, false},
		{"expired current source", &Release{URL: currentURL, CheckedAt: at.Add(-24 * time.Hour).Format(time.RFC3339)}, true},
		{"invalid date", &Release{URL: currentURL, CheckedAt: "invalid"}, true},
		{"future date", &Release{URL: currentURL, CheckedAt: at.Add(time.Hour).Format(time.RFC3339)}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := releaseNeedsRefresh(tc.release, at); got != tc.refresh {
				t.Fatalf("refresh = %v, want %v", got, tc.refresh)
			}
		})
	}
}
