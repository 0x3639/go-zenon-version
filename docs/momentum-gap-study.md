# Momentum gap study

The **Why the gaps?** tab in Pillar production compares empty slots for two groups fixed using the first hour after the configured reporting cutoff. It tests a specific observable implication of the fork hypothesis without assuming which chain a silent pillar follows.

## Interpretation

1. Count actual production by full producing address in `[PRODUCTION_SINCE, PRODUCTION_SINCE + 1 hour)`. Names are current registry labels, not identities.
2. Freeze the two groups: no baseline production, and at least one baseline momentum. Later production remains in the original group and can contradict the hypothesis. A baseline-zero group does not mean currently forked or currently inactive.
3. Analyze the latest **at most 12 completed five-minute rounds** wholly after the baseline. A checked frontier at or after round end closes the window. History must be complete, sequential, linked, and mainnet according to the configured public RPC. This is not independent signature/consensus validation.
4. Reconstruct the 30 ten-second assignments in each round with the pinned go-zenon algorithm, **current cached RPC registry/weights**, and the last historical momentum strictly before round start minus 300 seconds.
5. Compare every observed producer with that reconstruction. Include a round only if all match and at least five produced slots were checkable. Preserve all measured gaps, but exclude uncertain rounds from pillar and group attribution.
6. Compare each group's empty slots / assigned slots, using only included rounds. Show group counts, per-pillar counts and baseline production, and a round audit with proof links and exclusion reasons.

The descriptive readout waits for at least six included rounds and 20 assignments per group. These are display guardrails, not a statistical significance test. Matching observed slots cannot independently validate unproduced assignments. Current weights can differ from historical weights, exclusions can bias the result, and repeated pillar assignments are not independent trials. Registration changes and downtime are alternative explanations. A matching pattern does not establish another fork, peer IP, or producer software version.

The existing pillar activity rule remains separate: any production since the reporting cutoff rules out the dashboard's “Possibly forked out” warning for that window. A later one-hour gap is only “No production in 1h.” No identity links or `PILLAR_PEERS_JSON` values are inferred.

Relevant validator sources: [election proof and delegation lookup](https://github.com/zenon-network/go-zenon/blob/master/consensus/election.go), [deterministic election algorithm](https://github.com/zenon-network/go-zenon/blob/master/consensus/election_algorithm.go), and [RPC cache](https://github.com/zenon-network/go-zenon/blob/master/rpc/api/embedded/consensus_cache.go). The discovery build retains its existing pinned go-zenon dependency.

## Live validation: November 15, 2026

A local container built from this change read `wss://my.hc1node.com:35998` and rebuilt production history. These are measured chain observations, not simulated totals. Snapshot generated **17:49:06 UTC / 11:49:06 AM CST**:

| Item | Observed value |
| --- | --- |
| Baseline | 9:49–10:49 AM CST, 225 momentums |
| Later test | 10:50–11:45 AM CST, 11 completed rounds |
| Slots | 330 projected; 195 produced; 135 empty |
| Replay | 195 of 195 actual producers matched; all 11 rounds included |
| No production in baseline | 133 assigned; 1 produced; 132 empty (**99.2%**) |
| Produced in baseline | 197 assigned; 194 produced; 3 empty (**1.5%**) |
| Difference | 97.7 percentage points |
| Empty slots projected for baseline nonproducers | 132 of 135 (**97.8%**) |

The first group produced one momentum later: that observation is retained, not reclassified away. This supports the missed-assignment pattern in this window, while leaving fork status unknown. Results change with subsequent windows. [Captured API response](../tests/fixtures/gaps-live.json) is a dated test fixture, never a live fallback.

Preview screenshots render this captured response at its recorded time in the local frontend, not the deployed production website:

- [Desktop, 1440px viewport](previews/momentum-gap-study-desktop.png)
- [Mobile, 390px viewport](previews/momentum-gap-study-mobile.png)

## Resource and failure bounds

The existing production worker computes this study after a successful snapshot; it makes **no additional public RPC requests**. SQLite reads use a primary-key range of at most 360 baseline records and the latest 500 headers, sufficient for the one-hour test and proof lookback under the validated minimum ten-second timestamp increment. The derived study is cached in memory and recomputed from the existing persistent headers after restart. There is no additional service, subscription, database migration, or growing study table.

`GET /api/v1/production/gaps` uses the existing read-only/CORS policy and `Cache-Control: no-store`. Schema 1 / method `baseline-holdout-current-weights-v1` is documented in OpenAPI. Waiting windows are null. `all` includes every analyzed closed round; `comparable`, group and pillar counts include only rounds marked included. A study computation failure preserves the old study with its original timestamp and does not fail production collection. Source failures mark both snapshots unavailable. Freshness checks include the response time and chain tip; stale data has a historical-only readout.

The browser polls only while the study is open and the page visible, every 30 seconds, with a 12-second timeout, 2 MB response cap, cancellation on unmount, and request-error backoff capped at two minutes. Pillar rows paginate locally, ten at a time, without extra requests. Public feed text is rendered as text.

## Validation

All package execution and tests run in containers:

- `nodebox npm test`: parser consistency, current and captured live data, contradictory/insufficient evidence, null windows, exclusions, stale/future/error times, and legacy production/peer tests.
- `nodebox npm run build`: TypeScript, production bundle, generated documentation and OpenAPI/link checks.
- `docker build --target build -t zenon-production-build backend`: Go race tests and compiled backend. Synthetic linked history uses real elections to check frozen baseline membership, later production, window bounds, mismatch exclusion, low evidence, exclusive proof cutoffs, absent proof, broken coverage, database failures, CORS/HEAD/read-only behavior.
- Playwright in `tests/browser/compose.yaml`: desktop/mobile comparison, pagination, method/audit disclosure, search, failure backoff and retained timestamps, null/stale/insufficient windows, older backend, removal of Observer calls, and existing activity/timing/peer regressions.
- Live API parsing and screenshots; no horizontal page overflow at 1440px or 390px.

## Deployment

1. Merge the PR into `main`. This triggers **Publish dashboard** because frontend files changed. If necessary, run that workflow manually on `main` under GitHub **Actions**.
2. Redeploy the **go-zenon-version discovery** app in Coolify from `main`. Keep the existing domain, port 8080, `DISCOVERY_API_URL`, and persistent `/data` storage. Do not restart the retired independent Observer.
3. Verify `/api/v1/production/gaps`: initial `waiting`/`unavailable` is expected until history refreshes; `ready` requires a completed post-baseline round. Check `generatedAt`, `source`, and `frontier`. A missing route means the old discovery build is still running.
4. Open **Pillars → Why the gaps?**. Confirm both windows, replay coverage, group counts, and per-pillar rows. With an older backend, only the study shows the deployment message; the existing counts and timing continue working.

Rollback is the prior frontend/backend image. This update adds no database schema and changes no existing API payloads.
