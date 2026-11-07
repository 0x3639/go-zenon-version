import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { SITE_URL, DEFAULT_DISCOVERY_API } from '../src/site.ts';

const dist = new URL('../dist/', import.meta.url);
const read = (path: string) => readFile(new URL(path, dist), 'utf8');
const site = new URL(SITE_URL);

// Check the emitted site, including subdirectory URLs, before publishing it.
for (const path of ['index.html', 'guide/index.html']) {
  const html = await read(path);
  assert(!html.includes('{{SITE_URL}}') && !html.includes('{{API_URL}}'), `${path}: unresolved URL`);
  assert.match(html, /<html lang="en"/);
  assert.match(html, /<h1>/);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /property="og:image" content="https:\/\/[^\"]+\/og-image.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /rel="alternate" type="text\/markdown"/);
  assert.match(html, /rel="describedby" type="text\/plain"/);
  assert.match(html, /rel="sitemap"/);
  const data = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert(data, `${path}: missing structured data`);
  assert.equal(JSON.parse(data)['@context'], 'https://schema.org');
  for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    const url = new URL(match[1].replaceAll('&amp;', '&'), new URL(path, site));
    if (url.origin !== site.origin) continue;
    assert(url.pathname.startsWith(site.pathname), `${path}: URL escapes project path: ${url}`);
    const local = url.pathname.slice(site.pathname.length);
    const target = await stat(new URL(local || './', dist));
    if (target.isDirectory()) assert((await stat(new URL(`${local}index.html`, dist))).isFile());
    else assert(target.isFile(), `${path}: missing ${local}`);
  }
}
assert.match(await read('index.html'), /class="initial-content"/);
assert.match(await read('guide/index.html'), /Instructions for LLMs and data consumers/);
assert.match(await read('guide/index.html'), /Counts that must stay separate/);

for (const [name, width, height] of [
  ['og-image.png', 1200, 630], ['favicon-32.png', 32, 32], ['favicon-48.png', 48, 48],
  ['apple-touch-icon.png', 180, 180], ['icon-192.png', 192, 192], ['icon-512.png', 512, 512],
] as const) {
  const png = await readFile(new URL(name, dist));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), width, `${name}: width`);
  assert.equal(png.readUInt32BE(20), height, `${name}: height`);
}
const ico = await readFile(new URL('favicon.ico', dist));
assert.equal(ico.readUInt16LE(2), 1);
assert.equal(ico.readUInt16LE(4), 3);
for (let i = 0; i < 3; i++) {
  const at = 6 + i * 16, size = ico.readUInt32LE(at + 8), offset = ico.readUInt32LE(at + 12);
  assert(offset + size <= ico.length);
  assert.equal(ico.subarray(offset + 1, offset + 4).toString(), 'PNG');
}
assert.equal(await read('logo.svg'), await read('favicon.svg'), 'Shared logo drift');
const manifest = JSON.parse(await read('site.webmanifest'));
assert.equal(new URL(manifest.start_url, `${SITE_URL}site.webmanifest`).href, SITE_URL);
for (const icon of manifest.icons) assert((await stat(new URL(icon.src, dist))).isFile());

const sitemap = await read('sitemap.xml');
assert(sitemap.includes(`<loc>${SITE_URL}</loc>`));
assert(sitemap.includes(`<loc>${SITE_URL}guide/</loc>`));
assert.equal(await read('llms-full.txt'), await read('guide/index.md'));
for (const path of ['llms.txt', 'llms-full.txt', 'index.md']) {
  const text = await read(path);
  assert.match(text, /^# /);
  assert(!/\{\{[A-Z_]+\}\}/.test(text), `${path}: unresolved template`);
  assert(text.includes(`${SITE_URL}openapi.json`));
}

const api = JSON.parse(await read('openapi.json'));
assert.equal(api.openapi, '3.1.0');
assert.equal(api.servers[0].url, (process.env.VITE_DISCOVERY_API_URL?.trim() || DEFAULT_DISCOVERY_API).replace(/\/$/, ''));
assert.deepEqual(Object.keys(api.paths).sort(), ['/api/v1/ips', '/api/v1/momentums', '/api/v1/network', '/api/v1/nodes', '/healthz', '/readyz']);
for (const route of Object.values(api.paths) as Record<string, unknown>[]) assert.deepEqual(Object.keys(route), ['get']);
function references(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref') {
      assert.equal(typeof child, 'string');
      assert(String(child).startsWith('#/components/schemas/'));
      assert(api.components.schemas[String(child).split('/').at(-1)!], `Unresolved schema: ${child}`);
    } else references(child);
  }
}
references(api);
console.log('Verified built metadata, static content, project-path links, images, icons, sitemap, LLM files, and API schema references.');
