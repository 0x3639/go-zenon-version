import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Check, ChevronLeft, ChevronRight, CircleHelp, Copy, ExternalLink, Github, Globe2, Layers3, Network, Radio, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { DEFAULT_SEEDS, compareVersions, mergeSnapshots, parseSnapshot, scanNetwork, toCsv, validateSeed } from './network.ts';
import type { NodeRecord, Snapshot } from './network.ts';
import { classifySeeds, matchesSeedFilter, SEED_LABELS } from './seeds.ts';
import type { SeedFilter, SeedRole } from './seeds.ts';
import { connectionStatus, CONNECTION_LABELS, groupByIP, toIPCsv } from './reachability.ts';
import type { ConnectionStatus } from './reachability.ts';
import { GO_ZENON_SEEDS, GO_ZENON_SEED_SOURCE } from './go-zenon-seeds.ts';
import './style.css';
import { MomentumWatch } from './MomentumWatch.tsx';

const COLORS = ['#c0f181', '#7bb8ef', '#d1a7f3', '#f3c783', '#f196a6', '#8fc8bc'];
const STORAGE = 'zenon-observatory-settings';
const evidence: Record<NodeRecord['evidence'], string> = { p2p: 'P2P handshake', rpc: 'Direct RPC', peer: 'Peer advertised', discovery: 'Neighbor discovered' };
function readSettings(): { api?: string; seeds?: string[] } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? '{}');
    return { api: typeof saved?.api === 'string' ? saved.api : undefined,
      seeds: Array.isArray(saved?.seeds) && saved.seeds.length > 0 && saved.seeds.length <= 8 && saved.seeds.every((s: unknown) => typeof s === 'string') ? saved.seeds : undefined };
  } catch { return {}; }
}
function ago(date: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 1000));
  if (seconds < 60) return 'just now'; if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`; return `${Math.floor(seconds / 86400)}d ago`;
}
function host(endpoint: string) { try { return new URL(endpoint).hostname; } catch { return endpoint; } }
function short(id: string) { return `${id.slice(0, 8)}…${id.slice(-6)}`; }
function Logo({ small = false }: { small?: boolean }) {
  return <img className={`logo ${small ? 'small' : ''}`} src={`${import.meta.env.BASE_URL}logo.svg`} alt="" aria-hidden="true" width={small ? 24 : 40} height={small ? 24 : 40} />;
}
function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  return <dialog ref={ref} onCancel={close} onClick={e => { if (e.target === ref.current) close(); }}>
    <div className="dialog-top"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="Close dialog"><X size={20} /></button></div>{children}
  </dialog>;
}

function SeedBadges({ roles }: { roles: SeedRole[] }) {
  if (!roles.length) return null;
  return <span className="seed-badges">{roles.map(role => <span key={role} className={`seed-badge ${role}`}>{SEED_LABELS[role]}</span>)}</span>;
}

function Constellation({ nodes, sources, versions, select }: { nodes: NodeRecord[]; sources: Snapshot['sources']; versions: string[]; select: (n: NodeRecord) => void }) {
  const visible = useMemo(() => [...nodes].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 140), [nodes]);
  const seeds = sources.filter(s => s.status === 'ok' && /^https:|^wss:/.test(s.endpoint)).slice(0, 3);
  const positions = visible.map((node, i) => {
    const hash = parseInt(node.id.slice(0, 6), 16);
    const angle = i * 2.399963, radius = 70 + Math.sqrt(i / Math.max(visible.length, 1)) * 185;
    return { node, x: 390 + Math.cos(angle) * radius * 1.25, y: 184 + Math.sin(angle) * radius * .58,
      r: 3.4 + hash % 3, color: node.version ? COLORS[versions.indexOf(node.version) % COLORS.length] : '#738478' };
  });
  return <div className="constellation">
    <div className="map-grain" />
    <svg viewBox="0 0 780 370" role="img" aria-label={`Peer constellation showing ${visible.length} observed nodes. Lines connect peers to the seed that reported them; positions are illustrative.`}>
      <defs><radialGradient id="halo"><stop stopColor="#a9df71" stopOpacity=".13" /><stop offset="1" stopColor="#a9df71" stopOpacity="0" /></radialGradient><filter id="glow"><feGaussianBlur stdDeviation="3" /></filter></defs>
      <ellipse cx="390" cy="184" rx="280" ry="166" fill="url(#halo)" />
      {[90, 165, 245, 325].map(r => <ellipse key={r} cx="390" cy="184" rx={r} ry={r * .49} className="orbit" />)}
      <path d="M40 184H740M390 24V345" className="crosshair" />
      {positions.flatMap(p => seeds.map((seed, i) => p.node.sources.includes(seed.endpoint) && p.node.id !== seed.nodeId ?
        <line key={`${p.node.id}-${i}`} x1={390 + (i - (seeds.length - 1) / 2) * 65} y1={184 + (i % 2 ? 26 : -12)} x2={p.x} y2={p.y} stroke={p.color} strokeOpacity=".14" strokeWidth=".65" /> : null))}
      {positions.map(p => <g key={p.node.id} className="map-node" onClick={() => select(p.node)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(p.node); } }} tabIndex={0} role="button" aria-label={`${p.node.ip}, ${p.node.version ?? 'unknown version'}`}>
        <title>{p.node.ip} · {p.node.version ?? 'Unknown version'}</title><circle cx={p.x} cy={p.y} r={13} fill="transparent" /><circle cx={p.x} cy={p.y} r={p.r + 3} fill={p.color} opacity=".18" filter="url(#glow)" /><circle cx={p.x} cy={p.y} r={p.r} fill={p.color} opacity=".9" />
      </g>)}
      {seeds.map((seed, i) => <g key={seed.endpoint} transform={`translate(${390 + (i - (seeds.length - 1) / 2) * 65},${184 + (i % 2 ? 26 : -12)})`}><title>{host(seed.endpoint)}</title><circle r="17" fill="#151f17" stroke="#bde895" strokeOpacity=".6" /><circle r="5" fill="#c0f181" /><circle r="24" fill="none" stroke="#a9df71" strokeOpacity=".1" /></g>)}
      {!nodes.length && <text x="390" y="190" textAnchor="middle" fill="#819183" fontSize="13">Waiting for network observations</text>}
    </svg>
    <div className="map-caption"><span><i className="dot" /> RPC seed</span><span><i className="dot small-dot" /> Observed peer</span><span className="map-note">Topology, not geography{nodes.length > 140 ? ' · first 140 nodes' : ''}</span></div>
  </div>;
}

function App() {
  const savedSettings = useMemo(readSettings, []);
  const [api, setApi] = useState<string>(savedSettings.api ?? import.meta.env.VITE_DISCOVERY_API_URL ?? '');
  const [seeds, setSeeds] = useState<string[]>(savedSettings.seeds ?? DEFAULT_SEEDS);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Loading the latest network snapshot…');
  const [problem, setProblem] = useState(false);
  const [origin, setOrigin] = useState('Connecting');
  const [modal, setModal] = useState<'settings' | 'about' | 'sources' | null>(null);
  const [selected, setSelected] = useState<NodeRecord | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [proof, setProof] = useState('all');
  const [seedFilter, setSeedFilter] = useState<SeedFilter>('all');
  const [connectionFilter, setConnectionFilter] = useState<ConnectionStatus | 'all'>('all');
  const [sort, setSort] = useState('version');
  const [page, setPage] = useState(0);
  const [draftApi, setDraftApi] = useState(api);
  const [draftSeeds, setDraftSeeds] = useState(seeds.join('\n'));
  const [settingsError, setSettingsError] = useState('');
  const [copied, setCopied] = useState(false);
  const [, setClock] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const current = useRef<Snapshot | null>(null);
  const busyRef = useRef(false);
  const apply = (s: Snapshot) => { current.current = s; setSnapshot(s); };

  async function refresh(recursive = false, apiUrl = api, seedUrls = seeds) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setProblem(false);
    const control = new AbortController(); controller.current = control;
    try {
      if (apiUrl) {
        setMessage('Reading the discovery service…');
        const url = `${apiUrl.replace(/\/$/, '')}/api/v1/network`;
        const response = await fetch(url, { signal: AbortSignal.any([control.signal, AbortSignal.timeout(12000)]), credentials: 'omit' });
        if (!response.ok) throw new Error(response.status === 503 ? 'The discovery service is warming up. Try again shortly.' : `Discovery service returned HTTP ${response.status}.`);
        const data = parseSnapshot(await response.json()); apply(data); setOrigin('Discovery API');
        setMessage(`Discovery snapshot updated ${ago(data.generatedAt)}. ${data.scanning ? "The service is actively discovering peers." : data.limited ? "The scan budget was reached; later rounds continue exploring." : "The latest discovery round is complete."}`);
      } else {
        const base = current.current;
        setMessage(recursive ? 'Discovering reachable secure endpoints…' : 'Reading peer lists from your public seeds…');
        const result = await scanNetwork({ seeds: seedUrls, mode: 'browser', recursive, signal: control.signal,
          maxEndpoints: 80, budgetMs: 45000, onProgress: progress => {
            apply(mergeSnapshots(base, progress));
            setMessage(`${progress.nodes.length} peers observed · ${progress.sources.length} endpoints checked`);
          } });
        if (!result.sources.some(s => s.status === 'ok')) throw new Error('Public seeds could not be reached. Showing the last available snapshot.');
        apply(mergeSnapshots(base, result)); setOrigin('Browser + snapshot');
        setMessage(control.signal.aborted ? 'Scan stopped. Observations collected so far are shown.' : recursive ? `Scan finished${result.limited ? ' at its time or endpoint limit' : ''}. Nodes with private RPC need the discovery service.` : 'Public seed observations refreshed. Connect the discovery API for broader P2P coverage.');
      }
    } catch (error) {
      setProblem(true); setMessage(error instanceof Error ? error.message : 'Unable to refresh the network.');
    } finally { busyRef.current = false; setBusy(false); controller.current = null; }
  }
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/network.json`, { signal: AbortSignal.timeout(8000) });
        if (response.ok) { const s = parseSnapshot(await response.json()); if (active) { apply(s); setOrigin('Saved snapshot'); } }
      } catch { /* Live connections can still work without a bundled snapshot. */ }
      if (active) await refresh();
    })();
    return () => { active = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!api) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60000);
    return () => clearInterval(timer);
  }, [api, seeds]);
  useEffect(() => { setPage(0); }, [search, filter, proof, seedFilter, connectionFilter, sort]);
  useEffect(() => { const timer = setInterval(() => setClock(t => t + 1), 60000); return () => clearInterval(timer); }, []);

  const nodes = snapshot?.nodes ?? [];
  const seedRoles = useMemo(() => classifySeeds(snapshot?.nodes ?? [], snapshot?.sources ?? [], seeds), [snapshot, seeds]);
  const bootstrapCount = nodes.filter(n => seedRoles.get(n.id)?.includes('bootstrap')).length;
  const rpcSeedCount = nodes.filter(n => seedRoles.get(n.id)?.includes('rpc')).length;
  const seedCount = nodes.filter(n => seedRoles.get(n.id)?.length).length;
  const counts = useMemo(() => {
    const map = new Map<string, number>(); nodes.forEach(n => map.set(n.version ?? 'Unknown', (map.get(n.version ?? 'Unknown') ?? 0) + 1));
    return [...map.entries()].sort((a, b) => a[0] === 'Unknown' ? 1 : b[0] === 'Unknown' ? -1 : compareVersions(b[0], a[0]));
  }, [nodes]);
  const versions = counts.filter(([v]) => v !== 'Unknown').map(([v]) => v);
  const latest = snapshot?.release?.version ?? versions[0];
  const latestCount = nodes.filter(n => n.version === latest).length;
  const adoption = nodes.length ? Math.round(latestCount / nodes.length * 100) : 0;
  const direct = nodes.filter(n => connectionStatus(n) === 'confirmed').length;
  const uniqueIPs = useMemo(() => groupByIP(nodes), [nodes]);
  const filtered = nodes.filter(n => (filter === 'all' || (n.version ?? 'Unknown') === filter) && (proof === 'all' || n.evidence === proof) && matchesSeedFilter(seedRoles.get(n.id) ?? [], seedFilter) && (connectionFilter === 'all' || connectionStatus(n) === connectionFilter) && `${n.ip} ${n.id} ${n.version ?? ''} ${n.name}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === 'address' ? a.ip.localeCompare(b.ip, undefined, { numeric: true }) : sort === 'recent' ? b.lastSeen.localeCompare(a.lastSeen) : a.version && b.version ? compareVersions(b.version, a.version) || a.ip.localeCompare(b.ip) : a.version ? -1 : b.version ? 1 : a.ip.localeCompare(b.ip));
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const actualPage = Math.min(page, pages - 1);
  const rows = filtered.slice(actualPage * 10, actualPage * 10 + 10);
  let offset = 0;
  const gradient = counts.map(([v, count], i) => { const start = offset; offset += count / Math.max(nodes.length, 1) * 100; return `${v === 'Unknown' ? '#526257' : COLORS[i % COLORS.length]} ${start}% ${offset}%`; }).join(', ');
  const latestObservation = nodes.reduce((value, n) => n.lastSeen > value ? n.lastSeen : value, '');
  const stale = latestObservation && Date.now() - Date.parse(latestObservation) > 30 * 60 * 1000;
  function exportCsv(ips = false) {
    const url = URL.createObjectURL(new Blob([ips ? toIPCsv(filtered) : toCsv(filtered, new Map([...seedRoles].map(([id, roles]) => [id, roles.map(role => SEED_LABELS[role])])))], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `zenon-${ips ? 'ips' : 'peers'}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function saveSettings() {
    try {
      const next = draftApi.trim().replace(/\/$/, '');
      if (next) { const url = new URL(next); if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error('Enter a public HTTPS API base URL, such as https://discovery.example.com.'); }
      const nextSeeds = [...new Set(draftSeeds.split(/\s+/).filter(Boolean).map(validateSeed))];
      if (!nextSeeds.length || nextSeeds.length > 8) throw new Error('Enter between 1 and 8 seed URLs.');
      try { localStorage.setItem(STORAGE, JSON.stringify({ api: next, seeds: nextSeeds })); } catch { /* Session-only settings still work. */ }
      setApi(next); setSeeds(nextSeeds); setModal(null); void refresh(false, next, nextSeeds);
    } catch (error) { setSettingsError(error instanceof Error ? error.message : 'Check the settings.'); }
  }
  return <>
    <header className="topbar"><a className="brand" href="#"><Logo /><span>ZENON<span className="brand-divider">/</span><span className="brand-sub">observatory</span></span></a>
      <nav aria-label="Main navigation"><a href="#overview" className="active">Overview</a><a href="#momentums">Momentums</a><a href="#peers">Peer explorer</a><button onClick={() => setModal('about')}>How it works <ArrowUpRight size={13} /></button></nav>
      <a className="github-link" href="https://github.com/0x3639/go-zenon-version" target="_blank" rel="noreferrer" aria-label="View source on GitHub"><Github size={19} /><span>Source code</span></a>
    </header>
    <main id="overview">
      <div className="heading-row"><div><div className="eyebrow"><span className="tiny-cross">+</span> NETWORK INTELLIGENCE <span className="network-tag">ALPHANET</span></div><h1>Every peer. A clearer picture<span>.</span></h1><p className="intro">Explore the nodes powering Zenon. See what’s running across the network.</p></div>
        <div className="heading-actions"><button className="icon-button settings-button" aria-label="Connection settings" disabled={busy} onClick={() => { setDraftApi(api); setDraftSeeds(seeds.join('\n')); setSettingsError(''); setModal('settings'); }}><Settings2 size={18} /></button><button className="primary" onClick={() => busy ? controller.current?.abort() : void refresh(!api)}><RefreshCw size={16} className={busy ? 'spin' : ''} />{busy ? 'Stop refresh' : api ? 'Refresh network' : 'Scan network'}</button></div>
      </div>
      <div className="status-line"><span className={`connection ${problem || stale ? 'warn' : ''}`}><i className="dot" />{busy ? 'Connecting to the network' : origin}</span><span className="status-separator" /><span>{latestObservation ? `Last observed ${ago(latestObservation)}` : 'Waiting for first observation'}</span><button onClick={() => setModal('sources')}>{seeds.length} RPC seeds <ArrowUpRight size={12} /></button></div>
      <div className="data-source"><span><Radio size={14} /><b>{api && origin === 'Discovery API' ? 'P2P discovery service' : 'Public RPC view'}</b><span>{api && origin === 'Discovery API' ? snapshot?.scanning ? 'Discovery in progress · results update automatically' : 'UDP discovery + TCP version handshakes' : 'Seed observations + saved snapshot · connect the API for P2P discovery'}</span></span>{snapshot?.pillarCount != null && <span className="pillar-context" title={`Pillar registry checked ${snapshot.pillarCountCheckedAt ? new Date(snapshot.pillarCountCheckedAt).toLocaleString() : 'at last scan'}`}><b>{snapshot.pillarCount}</b> registered pillars <button aria-label="Why pillar and peer counts differ" onClick={() => setModal('about')}><CircleHelp size={13} /></button></span>}</div>
      {snapshot?.crawl && <div className="crawl-progress" aria-label="Discovery queue progress"><span><Network size={15} /><b>Discovery queue</b></span><span>{snapshot.crawl.candidates} known endpoints</span><span>{snapshot.crawl.attempted} checked at least once</span><span className="queue-count">{snapshot.crawl.pending} queued for this pass</span><span>{snapshot.crawl.completedPasses} completed passes</span>{snapshot.crawl.capped && <span className="queue-warning">Candidate limit reached</span>}<p>{snapshot.crawl.pending ? 'Remaining peers stay queued across batches and restarts.' : 'Every known endpoint has been attempted. Discovery and retries continue.'} An unsuccessful handshake can mean NAT, a firewall, or a peer declining the connection.</p></div>}
      <MomentumWatch api={api} />
      <section className="stats" aria-label="Network statistics">
        <article className="stat"><div className="stat-label">Observed nodes <Network size={17} /></div><div className="stat-number">{snapshot ? nodes.length : '—'}<span className="stat-badge"><i className="dot" /> unique peers</span></div><p>{uniqueIPs.length} unique public IPs · partial network view</p></article>
        <article className="stat"><div className="stat-label">Versions in the wild <Layers3 size={17} /></div><div className="stat-number">{snapshot ? versions.length : '—'}<span className="stat-text">reported versions</span></div><p>{nodes.filter(n => !n.version).length} nodes with an unknown version</p></article>
        <article className="stat"><div className="stat-label">{snapshot?.release ? 'Latest release adoption' : 'Highest observed version'}<Activity size={17} /></div><div className="stat-number">{nodes.length ? adoption : '—'}<span className="percent">%</span><span className="version-pill">{latest ?? 'Pending'}</span></div><div className="adoption-track"><span style={{ width: `${adoption}%` }} /></div><p>{latestCount} of {nodes.length} observed nodes</p></article>
        <article className="stat"><div className="stat-label">P2P handshakes <ShieldCheck size={17} /></div><div className="stat-number">{snapshot ? direct : '—'}<span className="stat-text">confirmed peers</span></div><p>{uniqueIPs.filter(ip => ip.confirmed > 0).length} unique IPs · latest recorded P2P result</p></article>
      </section>
      <section className="visuals">
        <article className="panel map-panel"><div className="panel-heading"><div><h2><Globe2 size={17} /> Peer constellation</h2><p>A connected view of the visible network</p></div><span className="pill"><i className="dot" /> {nodes.length} nodes</span></div><Constellation nodes={nodes} sources={snapshot?.sources ?? []} versions={versions} select={setSelected} /></article>
        <article className="panel distribution"><div className="panel-heading"><div><h2>Version distribution</h2><p>Software across observed peers</p></div><button className="plain-icon" aria-label="About version observations" onClick={() => setModal('about')}><CircleHelp size={16} /></button></div><div className="donut-area"><div className="donut" role="img" aria-label={counts.map(([v, n]) => `${v}: ${n} nodes`).join(', ') || 'No observations'} style={{ '--donut': gradient ? `conic-gradient(${gradient})` : '#29392e' } as CSSProperties}><div><strong>{snapshot ? nodes.length : '—'}</strong><span>observed nodes</span></div></div><span className="donut-label">GO-ZENON</span></div>
          <div className="legend">{counts.slice(0, 6).map(([v, n], i) => <button key={v} className={filter === v ? 'chosen' : ''} onClick={() => { setFilter(filter === v ? 'all' : v); document.getElementById('peers')?.scrollIntoView({ behavior: 'smooth' }); }}><span><i style={{ background: v === 'Unknown' ? '#526257' : COLORS[i % COLORS.length] }} />{v}{v === latest && <small>{snapshot?.release ? 'LATEST' : 'HIGHEST'}</small>}</span><span>{n}<b>{Math.round(n / nodes.length * 100)}%</b></span></button>)}{!counts.length && <p className="subtle">Distribution appears after the first response.</p>}</div>
        </article>
      </section>
      <div className={`notice ${problem ? 'notice-error' : ''}`} role="status"><Radio size={16} className={busy ? 'pulse' : ''} /><span>{message}</span><button onClick={() => setModal('about')}>About coverage <ArrowRight size={14} /></button></div>
      <section className="panel peers-panel" id="peers"><div className="panel-heading"><div className="table-title"><h2>Peer explorer</h2><span className="count-label">{nodes.length}</span><p>The network, node by node.</p></div><div className="export-actions"><button className="secondary" disabled={!filtered.length} onClick={() => exportCsv()}><ArrowDownToLine size={15} /> Export CSV</button><button className="secondary" disabled={!filtered.length} onClick={() => exportCsv(true)}>Unique IPs</button></div></div>
        <div className="filters"><label className="search"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search IP, public key, or version…" aria-label="Search peers" />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={15} /></button>}</label><label className="select-wrap"><SlidersHorizontal size={14} /><select aria-label="Filter by version" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All versions</option>{counts.map(([v]) => <option key={v}>{v}</option>)}</select></label><select aria-label="Filter by evidence" value={proof} onChange={e => setProof(e.target.value)}><option value="all">All observations</option>{Object.entries(evidence).map(([v, label]) => <option value={v} key={v}>{label}</option>)}</select><select aria-label="Filter by node role" value={seedFilter} onChange={e => setSeedFilter(e.target.value as SeedFilter)}><option value="all">All node roles</option><option value="seeds">Seed nodes ({seedCount})</option><option value="bootstrap">go-zenon seeds ({bootstrapCount})</option><option value="rpc">RPC seeds ({rpcSeedCount})</option><option value="other">Other peers ({nodes.length - seedCount})</option></select><select aria-label="Filter by P2P connection" value={connectionFilter} onChange={e => setConnectionFilter(e.target.value as ConnectionStatus | 'all')}><option value="all">All P2P results</option>{Object.entries(CONNECTION_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><select className="sort-select" aria-label="Sort peers" value={sort} onChange={e => setSort(e.target.value)}><option value="version">Version ↓</option><option value="address">Address ↑</option><option value="recent">Recent first</option></select></div>
        <div className="seed-summary"><span><b>{bootstrapCount}</b> of {GO_ZENON_SEEDS.length} go-zenon seed identities observed</span><a href={GO_ZENON_SEED_SOURCE} target="_blank" rel="noreferrer">Upstream seed list <ExternalLink size={11} /></a></div>
        <div className="table-scroll"><table><thead><tr><th>NODE / ADDRESS</th><th>GO-ZENON VERSION</th><th>OBSERVATION</th><th>LAST SEEN</th><th aria-label="Details" /></tr></thead><tbody>{rows.map(n => <tr key={n.id} onClick={() => { setSelected(n); setCopied(false); }}><td><span className="node-address"><span className="node-icon"><Network size={16} /></span><span><strong>{n.ip}</strong><code>{short(n.id)}</code><SeedBadges roles={seedRoles.get(n.id) ?? []} /></span></span></td><td><span className="table-version" style={{ '--version-color': n.version ? COLORS[versions.indexOf(n.version) % COLORS.length] : '#88978c' } as CSSProperties}><i className="dot" />{n.version ?? 'Unknown'}</span>{n.reportedVersions.length > 1 && <span className="conflict" title="Sources reported different versions">mixed reports</span>}</td><td><span className={`evidence ${['p2p', 'rpc'].includes(n.evidence) ? 'direct' : ''}`}>{['p2p', 'rpc'].includes(n.evidence) ? <ShieldCheck size={13} /> : <Radio size={13} />}{evidence[n.evidence]}</span><span className={`peer-check ${connectionStatus(n)}`} title={n.handshake ? `${n.handshake.ip}:${n.handshake.port} · ${new Date(n.handshake.attemptedAt).toLocaleString()}${n.handshake.error ? ` · ${n.handshake.error}` : ''}` : 'No detailed attempt history in this snapshot'}>{CONNECTION_LABELS[connectionStatus(n)]}</span></td><td className="last-seen" title={new Date(n.lastSeen).toLocaleString()}>{ago(n.lastSeen)}</td><td><button className="plain-icon" aria-label={`View peer ${n.ip}`} onClick={e => { e.stopPropagation(); setSelected(n); setCopied(false); }}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table>{!rows.length && <div className="empty"><Search size={28} /><h3>{nodes.length ? 'No peers match your filters' : 'Looking out across the network'}</h3><p>{nodes.length ? 'Try another address, version, node role, or P2P result.' : 'Observations will appear here as soon as a seed or discovery service responds.'}</p>{nodes.length > 0 && <button className="secondary" onClick={() => { setSearch(''); setFilter('all'); setProof('all'); setSeedFilter('all'); setConnectionFilter('all'); }}>Clear filters</button>}</div>}</div>
        <div className="pagination"><span>Showing <b>{filtered.length ? actualPage * 10 + 1 : 0}–{Math.min(actualPage * 10 + 10, filtered.length)}</b> of <b>{filtered.length}</b> peers</span><div><button className="icon-button" aria-label="Previous page" disabled={actualPage === 0} onClick={() => setPage(actualPage - 1)}><ChevronLeft size={17} /></button><span>{actualPage + 1} / {pages}</span><button className="icon-button" aria-label="Next page" disabled={actualPage >= pages - 1} onClick={() => setPage(actualPage + 1)}><ChevronRight size={17} /></button></div></div>
      </section>
      <div className="coverage-note"><CircleHelp size={14} /><p>A window into the network, not a complete census. Private, offline, or unreachable peers may be missing. Versions are self-reported.</p></div>
      <footer><span><Logo small /> Built for the Network of Momentum.</span><div><a href={`${import.meta.env.BASE_URL}guide/`}>Usage &amp; data guide</a><a href={`${import.meta.env.BASE_URL}llms.txt`}>LLM guide</a><a href={`${import.meta.env.BASE_URL}openapi.json`}>API</a><a href="https://github.com/zenon-network/go-zenon" target="_blank" rel="noreferrer">go-zenon <ArrowUpRight size={13} /></a></div></footer>
    </main>
    {modal === 'about' && <Modal title="A window into the network" close={() => setModal(null)}><div className="prose"><p>Zenon Observatory combines public seed reports with an optional peer discovery service. It counts unique public keys, so a node seen by several seeds appears once.</p><h3>Three ways to observe a version</h3><p><b>P2P handshake:</b> the Coolify service contacts the node’s TCP peer port (usually 35995), reads its advertised name, and disconnects. UDP neighbor discovery finds additional candidates.</p><p><b>Direct RPC:</b> a public node returns its own version through <code>stats.processInfo</code>.</p><p><b>Peer advertised:</b> a public seed reports the name a connected peer advertised. This often includes a version, even when that peer’s RPC is private.</p><h3>Direct connection checks</h3><p>Each discovered public endpoint enters a saved queue. The service attempts a TCP handshake and asks for UDP discovery neighbors, deduplicates the results, and continues until that queue is drained. A time limit pauses the work; the next batch resumes it. Later passes retry peers and explore more neighbors.</p><p><b>Handshake confirmed</b> means the latest recorded attempt completed directly. <b>Handshake unsuccessful</b> means it timed out or was declined; NAT, firewalls, and full connection slots can prevent inbound access. Advertised peers remain visible. Check timestamps rather than treating any result as a permanent online/offline status.</p><p>Unique IP exports group observed addresses while retaining all public keys. Several node identities can share one IP. A different address or port needs its own connection check.</p><h3>Which nodes are seeds?</h3><p><b>go-zenon seed:</b> its public key appears in the validator’s built-in <code>DefaultSeeders</code> list. <b>RPC seed:</b> it is one of the configured public RPC sources, identified by the endpoint’s own public key. A node can have both labels. Reporting a peer does not make that peer a seed.</p><p>Only observed identities enter the peer count. Unobserved entries in the seed list are not assumed to be online or offline.</p><h3>Peers and pillars are different counts</h3><p>The registered pillar count comes from <code>embedded.pillar.getAll</code>. A pillar is an on-chain registration; a peer is a network identity observed by this service. Nodes can be hidden or unreachable, and peer lists also include non-pillar nodes. These counts are not a coverage percentage.</p><h3>What the numbers mean</h3><p>Versions are self-reported, not an audit of the running binary. Unknown means a version could not be obtained. Timestamps belong to individual observations; older observations can remain visible for up to 24 hours in the discovery service.</p><p>The browser can query secure public APIs but cannot speak raw UDP or TCP. Without a discovery API, it combines the bundled snapshot with live seed observations. Browser scans also try secure RPC on discovered public addresses, which often fails because of TLS or browser restrictions.</p><p>Constellation lines show seed-reported connections. Node positions are illustrative. Full network coverage cannot be guaranteed.</p><a className="text-link" href="https://github.com/zenon-network/go-zenon/blob/master/rpc/api/stats.go" target="_blank" rel="noreferrer">Read the validator API <ExternalLink size={14} /></a></div></Modal>}
    {modal === 'settings' && <Modal title="Connect your observatory" close={() => setModal(null)}><div className="prose"><p>Connect the discovery service running on Coolify for deeper P2P coverage. Settings are saved in this browser.</p><label className="field-label" htmlFor="api-url">Discovery API base URL</label><input id="api-url" className="field" value={draftApi} onChange={e => setDraftApi(e.target.value)} placeholder="https://discovery.example.com" /><p className="field-hint">Leave blank to use public seeds and the bundled snapshot. The API must allow this site’s origin.</p><label className="field-label" htmlFor="seeds">Public RPC seeds</label><textarea id="seeds" className="field" rows={4} value={draftSeeds} onChange={e => setDraftSeeds(e.target.value)} /><p className="field-hint">One WSS or HTTPS endpoint per line. Seeds are used for browser scans; the server’s seeds are configured on Coolify.</p>{settingsError && <p className="form-error" role="alert">{settingsError}</p>}<button className="primary full" onClick={saveSettings}>Save & connect <ArrowRight size={16} /></button></div></Modal>}
    {modal === 'sources' && <Modal title="Discovery sources" close={() => setModal(null)}><div className="prose"><p>{api ? `Reading the discovery API at ${api}` : 'Using public seeds and the saved network snapshot.'}</p>{seeds.map(seed => { const s = snapshot?.sources.find(s => s.endpoint === seed); return <div className="source-item" key={seed}><div><strong>{host(seed)}</strong><code>{seed}</code></div><span className={`source-status ${s?.status === 'ok' ? 'success' : ''}`}>{s?.status === 'ok' ? `${s.peerCount} peers` : s ? 'Unavailable' : 'Pending'}</span></div>; })}<h3>go-zenon bootstrap seeds</h3><p>{bootstrapCount} of {GO_ZENON_SEEDS.length} listed seed identities have been observed. The service rotates through this list alongside discovered peers. Entries without observations are excluded from node totals.</p><a className="text-link" href={GO_ZENON_SEED_SOURCE} target="_blank" rel="noreferrer">View the validator’s seed list <ExternalLink size={14} /></a><p>{snapshot?.sources.filter(s => s.status === 'ok').length ?? 0} successful source requests. An unavailable RPC endpoint does not mean a peer is offline.</p><details><summary>View endpoint results ({snapshot?.sources.length ?? 0})</summary><div className="source-log">{snapshot?.sources.map(s => <div key={s.endpoint}><code>{s.endpoint}</code><span>{s.status === 'ok' ? `${s.peerCount} peers · ${ago(s.checkedAt)}` : s.error}</span></div>)}</div></details></div></Modal>}
    {selected && <Modal title="Peer details" close={() => setSelected(null)}><div className="prose"><div className="detail-hero"><span className="node-icon"><Network size={23} /></span><div><h3>{selected.ip}</h3><span>{selected.version ?? 'Version unknown'} · {evidence[selected.evidence]}</span><SeedBadges roles={seedRoles.get(selected.id) ?? []} /></div></div><label className="field-label">Public key</label><div className="key-block"><code>{selected.id}</code><button className="icon-button" aria-label="Copy public key" onClick={async () => { try { await navigator.clipboard.writeText(selected.id); setCopied(true); } catch { setCopied(false); } }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div><dl><dt>P2P connection</dt><dd>{CONNECTION_LABELS[connectionStatus(selected)]}</dd>{selected.handshake && <><dt>Checked endpoint</dt><dd>{selected.handshake.ip}:{selected.handshake.port}</dd><dt>Last P2P attempt</dt><dd>{new Date(selected.handshake.attemptedAt).toLocaleString()}</dd><dt>Last P2P success</dt><dd>{selected.handshake.lastSuccessAt ? new Date(selected.handshake.lastSuccessAt).toLocaleString() : 'No successful handshake recorded'}</dd>{selected.handshake.error && <><dt>Attempt result</dt><dd>{selected.handshake.error}</dd></>}</>}{selected.lastDiscoveryAt && <><dt>Last UDP response</dt><dd>{new Date(selected.lastDiscoveryAt).toLocaleString()}</dd></>}<dt>Advertised name</dt><dd>{selected.name || 'Not reported'}</dd><dt>Last observed</dt><dd>{new Date(selected.lastSeen).toLocaleString()}</dd><dt>First observed</dt><dd>{new Date(selected.firstSeen).toLocaleString()}</dd><dt>Reported versions</dt><dd>{selected.reportedVersions.join(', ') || 'Unknown'}</dd>{selected.commit && <><dt>Reported commit</dt><dd><code>{selected.commit}</code></dd></>}</dl><h3>Seen through</h3><div className="source-log">{selected.sources.map(s => <code key={s}>{s}</code>)}</div></div></Modal>}
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
