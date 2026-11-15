# Post-spork peer version scope

The dashboard now hides peers advertising software below **v0.0.9**, retaining v0.0.9 and newer as requested. The central policy is `MIN_PEER_VERSION` in `src/network-summary.ts`; it uses semantic version ordering, including prerelease/build handling. It is independent of the latest release feed and does not assert chain membership.

The filter runs before computing peer/IP/seed counts, adoption, distribution, map nodes/seed markers, search, pagination, and exports. “All in scope” cannot restore excluded peers. Unknown versions remain unclassified and preserve the existing distinction between reported peers and discovery-only candidates. An upgraded peer is evaluated using its current version field, not an older entry in `reportedVersions`.

The raw collector dataset, crawl queue, and historical Observer/momentum evidence retain their recorded data. Queue diagnostics explicitly describe the full collector workload. The Observer panel explains that its historical relay evidence is outside the peer-inventory cutoff. Empty filtered snapshots show an explanation rather than waiting for observations that already arrived.

## Validation

All dependency execution used nodebox or Docker containers.

- 45 unit tests passed, including cutoff boundaries, prereleases, build metadata, numeric v0.0.9/v0.0.10 ordering, unknown versions, mixed historical reports, and empty inputs.
- Production build passed, including TypeScript and generated guide/LLM/metadata verification.
- 18 desktop/mobile browser checks passed. These include counts, version options, excluded seed markers, navigation/filter reset, search, both CSV downloads, empty saved snapshots, and existing Observer behaviors.
- A live discovery API response generated **2026-11-15T16:07:17Z** was captured with the production CORS origin, then replayed into desktop and mobile previews to keep both layouts consistent. Both showed **52 reported peers** and **14 older-version peers hidden**. No horizontal page overflow was found. Counts change as new snapshots arrive.

[Desktop preview](previews/post-spork-desktop.png) · [Mobile preview](previews/post-spork-mobile.png)

## Publish

Merge the PR into `main` to trigger **Publish dashboard**, or run it manually from Actions. No new repository variables and no Coolify redeploy are required for this change. Check the “Peer version scope: v0.0.9 and newer” notice, confirm v0.0.9 remains available, and verify older versions are absent from the explorer/version options. Reverting the frontend commit restores the earlier display; no backend observations are deleted.
