# Pillar production and momentum timing validation

Validated November 15, 2026. This update replaces the independent Observer integration and correlation UI with actual chain-history counts and intervals in the existing discovery service. Peer version scope remains **v0.0.9 and newer**, including unclassified unknown versions.

## What users see

- **Pillars** navigation opens a searchable, sortable list with current pillar name, full producing address, produced count since the configured cutoff, share, latest production, and activity. A public RPC's registered pillars with zero counts remain in the list.
- **Possibly forked out** means at least one hour without production, measured through the checked chain tip. Complete and fresh coverage is required. This is an inactivity flag; downtime, missed slots, low election frequency, and new registrations can also explain it. It does not prove a different chain.
- **Momentum timing** shows actual producers and every stored interval, with 10 seconds as the expected cadence. Longer gaps are highlighted. Latest/average/longest statistics cover the full checked reporting window. Older pages remain fixed while the current snapshot updates.
- Observer navigation, its entire panel, selected-pillar relay evidence, all associated requests, and its build variables are removed. The reconstruction-mismatch warning is removed; stale-schedule warnings and projection labels remain.
- Software versions still require the existing configured identity link. No production record, inactivity result, IP, or name fills an unknown software version or changes `PILLAR_PEERS_JSON`.

## Automated checks

All dependency execution used nodebox or Docker containers.

| Check | Result |
| --- | --- |
| `nodebox npm test` | 31 tests passed, including production payloads, null/empty/partial data, unsupported/inconsistent inputs, exact one-hour inactivity boundary, stale suppression, and fixed-tip history parsing |
| `nodebox npm run build` | TypeScript, production bundle, generated HTML/Markdown/LLM references/OpenAPI, and metadata/asset/link verification passed |
| `docker build --target build -t zenon-production-build backend` | All Go race tests and CGO build passed |
| Browser suite in Playwright container | 12 tests passed at desktop 1440×1000 and mobile 390×844 |

Backend production tests cover inclusive cutoff and CST conversion, predecessor timing, zero-production registry rows, durable restart, duplicate polls, atomic rejection of broken links, bounded 500-header passes, catch-up resume, reorg rebuilds, conflicting fallback rejection, preserved timestamps on failure, stale-source rejection, future cutoff handling, changed-cutoff rebuilds, CORS, read-only methods, HEAD, pagination bounds, and a changed pinned tip.

Browser tests cover count/list filtering and search, one-hour flags, longer intervals, actual producer rows, no Observer requests/UI, absence of the removed warning, unknown pillar versions, partial/error states, request backoff, older-backend 404 isolation, fixed-tip pagination, and the prior peer/version/export regressions. Mobile rows use cards so count, activity, and timing remain visible without horizontal scrolling. No document overflow or page errors were found.

## Live public-node comparison

A local container running the production backend queried `wss://my.hc1node.com:35998`. A separate nodebox WebSocket client fetched the entire same pinned range using `ledger.getMomentumsByHeight`, independently regrouped producing addresses, and recomputed each interval. All results matched.

| Fact | Checked value |
| --- | --- |
| Reporting boundary | 2026-11-15 15:49:00 UTC / 9:49 AM CST, inclusive |
| Snapshot generated | 2026-11-15 16:34:05 UTC / 10:34:05 AM CST |
| First included height | 14,671,382, timestamp exactly at the reporting boundary |
| Predecessor | Timestamp 15:48:50 UTC; first measured gap 10 seconds |
| Last checked height | 14,671,554 |
| Momentums | 173 |
| Current registered pillars | 98 |
| Producing addresses in this window | 42 |
| Mean completed interval | 15.54913294797688 seconds |
| Shortest / longest / latest interval | 10 / 70 / 10 seconds |

These are dated verification results, not hardcoded dashboard values or a present network total. The worker was complete for that reference-node range. It does not independently verify signatures/consensus or establish the fork activation height.

The public API's pinned history returned all 173 records over four 50-row pages, with no duplicates or omissions and the correct CORS origin. After later collecting 178 momentums, restarting the local container preserved the count, first height, and original generated time; it correctly started as **stale** before revalidation. Only the isolated local service was restarted; the deployed Coolify apps were not changed.

## Preview evidence

The following screenshots use the captured live snapshot above, replayed at its observation time for a consistent desktop/mobile comparison. They are not fabricated production totals. Explorer links resolved to real momentum detail pages. At this snapshot the reporting window was under one hour, so a zero-count pillar was not yet eligible for the inactivity flag; the exact threshold and stale/partial suppression are covered by the automated tests.

| View | Desktop | Mobile |
| --- | --- | --- |
| Pillar production | [Screenshot](previews/pillar-production-desktop.png) | [Screenshot](previews/pillar-production-mobile.png) |
| Momentum timing | [Screenshot](previews/momentum-timing-desktop.png) | [Screenshot](previews/momentum-timing-mobile.png) |

[Complete desktop timing panel](previews/momentum-timing-detail.png)

The list uses [ZenonHub's pillar list](https://zenonhub.io/pillars) as a layout reference. Counts here describe the configured post-fork reporting window, not ZenonHub's own statistics period.

## Deployment and rollback

1. Merge and redeploy the **go-zenon-version discovery** app from `main` in Coolify. Keep its port 8080, existing domain, and persistent writable `/data` volume. This update adds `/data/production.sqlite` and its WAL files. No new service, domain, or public P2P port is needed.
2. Default runtime cutoff is `PRODUCTION_SINCE=2026-11-15T15:49:00Z`. Verify the date before interpreting counts. Changing the cutoff rebuilds stored history. The volume grows as each header/interval is retained; loss of the volume requires a bounded RPC backfill.
3. Check `/api/v1/production` for the intended `since`, current `generatedAt`, and eventually `status: ready`, `complete: true`, `remaining: 0`. RPC problems remain isolated from the existing peer/schedule routes.
4. Merge triggers **Publish dashboard**, or run it manually in GitHub Actions on `main`. Keep the existing `DISCOVERY_API_URL`. Old Observer variables are ignored and may be deleted. If Pages deploys first, only the production section waits for the new backend.
5. Reload [Pillars](https://0x3639.com/go-zenon-version/#pillars). The independent `go-zenon-pillar-version` app can remain stopped.

To roll back, deploy the prior discovery commit and revert the frontend change. The old backend ignores `production.sqlite`; preserve the volume for a future redeploy. A frontend-only rollback would restore the old Observer UI, which will be unavailable while its app is stopped. Peer filtering from PR #3 is not changed by this update.

## Post-merge review follow-up

PR #4's review identified a startup deadline shorter than a slow-but-healthy timestamp search. The initial source attempt now has a bounded five-minute allowance until the first production checkpoint; subsequent attempts retain the 45-second limit. Each RPC retains its existing timeout and shutdown cancellation still takes precedence. A deterministic regression at height 14.7 million accounts for two seconds per RPC without wall-clock sleeps: the old deadline fails before any records commit, while the initial allowance completes the search and count. Normal polling and parent cancellation are also checked.

The panel and machine-readable entry points now say **reporting cutoff** and clarify that it is not an independently verified fork height. The configured date, counts, and one-hour inactivity rule are unchanged. Screenshots above record the original PR #4 labels. Follow-up validation passed 31 frontend tests, eight production browser tests across desktop/mobile, the site build, and all Go race tests/build in containers.
