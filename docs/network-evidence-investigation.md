# Network counts, versions, and Observer investigation — 2026-11-14

## Findings

The merged association PR (#1, merge `a2738e7`) did not change discovery, `src/main.tsx` node totals, or the crawler. The previous UI counted every discovered public key, including neighbor referrals without software evidence, in its headline and adoption denominator. The increase came from the live discovery dataset, not Observer rows being added to peer totals.

At 10:42 UTC, the [discovery API](https://tw7v2v7y9rjq7mle1isnlktq.172.245.238.165.sslip.io/api/v1/network) returned:

| Measurement | Count |
| --- | ---: |
| Unique public keys | 166 |
| Unique public IPs across all identities | 129 |
| RPC / peer-list / P2P software reports | 64 |
| Discovery-only identities, all unknown version | 102 |
| Latest matching P2P handshake confirmed | 33 |
| Reported v0.0.10 | 47 |
| Reported v0.0.9 | 4 |
| Reported v0.0.8 | 12 |
| Reported v0.0.1 | 1 |

All 102 discovery-only identities had unsuccessful latest handshakes. Of these, 93 used addresses in `124.243.154.0/24`. This is a concentration of referrals, not proof of reachable Zenon nodes, an attack, or pillar ownership. No IP-range blacklist was added. The Nov 7 bundled snapshot had 72 identities, including 12 unknown versions: known versions increased from 60 to 64 while unknown referrals accounted for most of the total increase. IDs were unique; multiple IDs sharing an IP are not necessarily duplicates.

GitHub's [upstream release API](https://api.github.com/repos/zenon-network/go-zenon/releases/latest) and [release list](https://github.com/zenon-network/go-zenon/releases) still reported `v0.0.9-alphanet` / name `v0.0.9` when checked. The discovery backend caches that source for 24 hours. Re-fetching it did not return v0.0.10. The old frontend always preferred that record over the higher advertised version, producing the screenshot's 4/166 = 2% card. We do not treat a peer advertisement as release certification or hardcode a version.

## What changes on the dashboard

- **Reported peers** shows RPC, peer-list, and P2P reports, including unparseable software and failed subsequent handshakes. NAT-hidden peers remain eligible through peer reports.
- **Discovery-only candidates** have a separate count and action. The explorer defaults to reported peers; its evidence filter can still show candidates or all identities. No API records are removed.
- The constellation and distribution use reported peers. The version card uses only known versions. In the captured dataset it shows **Highest observed version v0.0.10**, **47 of 64**, **73%**. The GitHub published record and check age remain visible separately. The label becomes **Published release adoption** when that record is not behind observed versions.
- Observer rows show remaining samples/days, missing holdout evidence, a page-only threshold count, and an invitation to update fixed dates when newer complete hours exist. Polling and pagination do not move the chosen window automatically.

## Why association results remain inconclusive

The [Observer status](https://zsjo46q7s0qcmaklbmak7gfp.172.245.238.165.sslip.io/api/v1/status) at approximately 10:45 UTC reported schema 1.1, method association-2, release 0.3.1-associations, four connected relays, 161 processed hours, zero pending/retrying hours, and no current analysis error. Collection and summary computation were functioning.

A complete producer-filtered query for AlienApeZ (`z1qp0mxukh55e6m5q4yxsukz5xhwnt9n5cg49tnj`), from `2026-11-07T10:00:00Z` to `2026-11-14T10:00:00Z`, returned 76 rows and `nextOffset: null`. All had `insufficient_data`. They covered ten cohorts, with at most 35 samples per row and at most two UTC days. These are findings for this producing address and interval, not an exhaustive result across all pillars.

The [association-2 contract](https://github.com/0x3639/go-zenon-pillar-version/blob/eec750f3bc31cb8f2bd523fc7066ae49435b640b/docs/association-analysis.md) requires at least 100 samples across three UTC days **within the same boot/cohort/event category**. Session changes create separate cohorts. Live session history showed relay upgrades from 0.0.8/0.0.9 to 0.0.10, reconnects, an EOF disconnect, and a timeout/reconnect. Therefore elapsed service uptime is not the same as comparable evidence accumulating in one row. Keeping relays connected longer may help; it does not guarantee threshold or holdout success.

The default seven-day holdout split was Nov 10 at 22:00 UTC. Eligible rows in this producer query started Nov 12, leaving the earlier half empty. Its summary also reported seven missing hours and 63,680 `unsafe_or_unknown_run` comparison exclusions. A new response timestamp does not repair absent historical evidence. Raw evidence from interrupted/unsafe runs is deliberately withheld by the Observer's method.

Historical relay rows can show 0.0.8/0.0.9 even though current peer sessions advertise 0.0.10. Version observation timestamps identify the historical segment. No relay observation fills a pillar's software version, and no observer evidence changes `PILLAR_PEERS_JSON`.

If frequent session changes continue preventing useful comparisons, the independent Observer project needs a method review of cohort stability and holdout-window selection, preserving comparable denominators and version boundaries. The frontend cannot safely pool these groups or lower the thresholds on its own. This change makes that limitation visible; it does not claim to solve it.

## Validation and deployment

All dependency execution used nodebox or Docker containers. No discovery backend or Observer service changes are included.

- 43 unit tests pass, including the captured 166/102/64/47 count regression, unknown versions, failed handshakes, published versus observed versions, cohort progress, and fixed-window freshness.
- Builds with `VITE_OBSERVER_ENABLED=true` and `false` pass, including TypeScript and generated metadata/guide/LLM checks.
- Desktop (1440 px) and mobile (390 px) checks cover candidate access, filters, pagination, stale/error/backoff states, cohort progress, fixed dates, and zero Observer requests with its flag disabled.
- Live Observer integration passes on desktop/mobile with schema 1.1 / association-2, the production CORS origin, producing-address filtering, pagination, raw arrivals, and selected pillar evidence. The preview only bridges CORS for localhost; production code is unchanged.

Preview evidence:

- [Desktop overview](previews/network-evidence-desktop.png) / [mobile overview](previews/network-evidence-mobile.png): deterministic fixture with the captured identity/version counts and synthetic addresses (not a live IP census).
- [Live association progress](previews/association-progress-desktop.png) / [live mobile relay evidence](previews/association-progress-mobile.png): actual Observer payloads on Nov 14.

Merge this PR into `main`; **Publish dashboard** runs automatically for frontend changes. If needed, run it manually under Actions → Publish dashboard → Run workflow → main. Retain the existing `DISCOVERY_API_URL`, `OBSERVER_ENABLED=true`, and optional `OBSERVER_API_URL` repository variables. Neither Coolify application needs a redeploy. Confirm reported/candidate counts, version labels, and the Observer evidence on the published page; live counts may have changed since this investigation. Reverting the frontend commit and publishing again restores the previous presentation without changing stored data.
