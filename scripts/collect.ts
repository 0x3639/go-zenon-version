import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { DEFAULT_SEEDS, parseSnapshot, parseVersion, scanNetwork } from '../src/network.ts';
import type { Release } from '../src/network.ts';

const output = new URL('../public/data/network.json', import.meta.url);
let previousRelease: Release | null = null;
try { previousRelease = parseSnapshot(JSON.parse(await readFile(output, 'utf8'))).release; } catch { /* First run. */ }
const seeds = process.env.ZENON_SEEDS?.split(',').map(s => s.trim()).filter(Boolean) ?? DEFAULT_SEEDS;
const snapshot = await scanNetwork({ seeds, mode: 'collector', recursive: true, maxEndpoints: 200,
  budgetMs: 180000, timeoutMs: 5000, concurrency: 6,
  onProgress: s => { if (s.sources.length % 20 === 0) console.log(`${s.nodes.length} peers observed; ${s.sources.length} endpoints checked`); },
});
if (!snapshot.sources.some(s => s.status === 'ok')) {
  console.error('No node returned a peer list. Keeping the previous snapshot.');
  process.exitCode = 1;
} else {
  snapshot.release = previousRelease;
  try {
    const response = await fetch('https://api.github.com/repos/zenon-network/go-zenon/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    const release = await response.json();
    // The release title is the binary version; the tag includes the network label "-alphanet".
    const version = parseVersion(release.name) ?? parseVersion(release.tag_name);
    if (version) snapshot.release = { version, tag: release.tag_name,
      url: `https://github.com/zenon-network/go-zenon/releases/tag/${encodeURIComponent(release.tag_name)}`,
      checkedAt: new Date().toISOString() };
  } catch (error) { console.warn('Could not refresh release metadata:', String(error)); }
  await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
  await writeFile(`${output.pathname}.tmp`, JSON.stringify(snapshot, null, 2) + '\n');
  await rename(`${output.pathname}.tmp`, output);
  console.log(`Saved ${snapshot.nodes.length} unique nodes from ${snapshot.sources.filter(s => s.status === 'ok').length} responsive RPC endpoints.`);
}
