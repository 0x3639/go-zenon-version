import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const fixtures = JSON.parse(readFileSync(new URL('../fixtures/observer-1.1.json', import.meta.url), 'utf8'));
const api = 'https://zsjo46q7s0qcmaklbmak7gfp.172.245.238.165.sslip.io';
const discovery = 'https://tw7v2v7y9rjq7mle1isnlktq.172.245.238.165.sslip.io';
const at = new Date('2026-11-12T10:45:10Z');
const producer = fixtures.associations.result.data[0].producerAddress;
const other = fixtures.momentums.result.data[0].producerAddress;
const disabled = process.env.OBSERVER_PREVIEW_ENABLED === 'false';

async function setup(page: Page) {
  await page.clock.install({ time: at });
  const state = { fail: false, stale: false, legacy: false, linked: false, requested: [] as URL[] };
  await page.route(`${discovery}/**`, async route => {
    if (!route.request().url().includes('/momentums')) return route.fulfill({ status: 503, body: '{}' });
    const unix = at.getTime() / 1000, genesis = 1637755200;
    const slots = Array.from({ length: 30 }, (_, i) => {
      const startsAt = unix + 10 + i * 10, since = startsAt - genesis;
      return { round: Math.floor(since / 300), index: Math.floor((since % 300) / 10) + 1, startsAt, pillar: i % 2 ? 'Other pillar' : 'AlienApeZ', producer: i % 2 ? other : producer, software: state.linked && i % 2 === 0 ? { version: 'v0.0.9', reason: 'configured-peer-link', peerId: 'c'.repeat(128), evidence: 'p2p', observedAt: at.toISOString() } : { version: null, reason: 'no-pillar-peer-link' } };
    });
    return route.fulfill({ json: { schemaVersion: 1, generatedAt: at.toISOString(), status: 'ready', source: 'wss://example.com', basis: 'rpc-current-weights', genesis, slotSeconds: 10, checked: 120, matched: 120, frontier: { height: 14646054, timestamp: unix, hash: '1'.repeat(64), previousHash: '0'.repeat(64), producer, chainIdentifier: 1 }, rounds: [], slots } });
  });
  await page.route(`${api}/**`, async route => {
    const url = new URL(route.request().url()); state.requested.push(url);
    let key = url.pathname.split('/').at(-1)!;
    if (url.pathname.includes('/pillars/')) key = 'pillar-null';
    const response = structuredClone(fixtures[key]);
    if (!response) return route.fulfill({ status: 404, body: '{}' });
    if (state.fail && key === 'associations') return route.fulfill({ status: 503, headers: { 'Retry-After': '60', 'Access-Control-Expose-Headers': 'Retry-After' }, body: '{}' });
    response.generatedAt = new Date(state.stale ? at.getTime() - 300000 : at).toISOString();
    response.dataQuality.statusUpdatedAt = response.generatedAt;
    if (state.legacy) {
      response.schemaVersion = '1.0'; response.methodVersion = 'collection-1';
      if (key === 'arrivals') response.result.data.forEach((a: { rankingEligible: boolean | null }) => { a.rankingEligible = false; });
    }
    if (key === 'pillar-null') response.result.producerAddress = url.pathname.split('/').at(-1);
    if (key === 'associations') {
      if (state.legacy) {
        response.schemaVersion = '1.0'; response.methodVersion = 'collection-1';
        response.result = { available: false, data: [], nextOffset: null, producerSoftwareVersion: null, reason: 'association_analysis_not_implemented' };
      } else {
        if (url.searchParams.has('from')) response.windowStart = url.searchParams.get('from');
        if (url.searchParams.has('to')) response.windowEnd = url.searchParams.get('to');
        const offset = Number(url.searchParams.get('offset') || 0);
        if (offset > 0) response.result.data.forEach((r: { cohortId: string }) => { r.cohortId = 'later-page-cohort'; });
        response.result.data = response.result.data.filter((r: { producerAddress: string; eventKind: string }) => (!url.searchParams.get('producer') || r.producerAddress === url.searchParams.get('producer')) && (!url.searchParams.get('eventKind') || r.eventKind === url.searchParams.get('eventKind'))).slice(0, Number(url.searchParams.get('limit')) || 10);
        response.result.nextOffset = response.result.data.length && offset === 0 ? 2 : null;
      }
    }
    await route.fulfill({ json: response });
  });
  return state;
}

test('relay evidence is selected by full address, bounded, and never changes pillar versions', async ({ page }) => {
  test.skip(disabled);
  const state = await setup(page); await page.goto('/');
  const observer = page.locator('#observer');
  await expect(observer.locator('.association-card')).toHaveCount(2);
  await expect(observer.getByText('Incomplete coverage.', { exact: false })).toBeVisible();
  expect(state.requested.filter(u => u.searchParams.has('producer'))).toHaveLength(0);
  const momentum = page.locator('#momentums');
  await expect(momentum.getByRole('button', { name: 'View relay evidence' })).toHaveCount(1);
  await momentum.getByRole('button', { name: 'View relay evidence' }).click();
  await expect(momentum.locator('.association-card')).toHaveCount(2);
  expect(state.requested.filter(u => u.searchParams.has('producer')).every(u => u.searchParams.get('producer') === producer)).toBeTruthy();
  expect(state.requested.filter(u => u.searchParams.has('producer')).length).toBe(2);
  await expect(momentum.locator('.slot-inspector .momentum-version')).toHaveText('Version unknown');
  await expect(momentum.locator('.association-card').first().getByText('0.0.8', { exact: true })).toBeVisible();
  await page.clock.runFor(11000);
  await expect(momentum.getByRole('button', { name: 'Close relay evidence' })).toBeVisible();
  await expect(momentum.locator('.slot-inspector').getByText('AlienApeZ')).toBeVisible();
  state.linked = true;
  await page.clock.runFor(10000);
  await expect(momentum.locator('.slot-inspector .momentum-version')).toHaveText('v0.0.9');
  await expect(momentum.locator('.association-card').first().getByText('0.0.8', { exact: true })).toBeVisible();
  await momentum.locator('.pillar-inspect').filter({ hasText: 'Other pillar' }).first().click();
  await expect(momentum.getByRole('button', { name: 'View relay evidence' })).toBeVisible();
  await expect(momentum.locator('.association-card')).toHaveCount(0);
  await momentum.getByRole('button', { name: 'View relay evidence' }).click();
  await expect(momentum.getByText('No relay comparisons returned', { exact: false })).toBeVisible();
  expect(state.requested.filter(u => u.searchParams.get('producer') === other).length).toBe(2);
});

test('pagination keeps its window; a failed next page still allows returning to previous evidence', async ({ page }) => {
  test.skip(disabled);
  const state = await setup(page); await page.goto('/#observer');
  const panel = page.locator('#observer');
  await expect(panel.locator('.association-card')).toHaveCount(2);
  const first = state.requested.find(u => u.pathname.endsWith('associations') && u.searchParams.has('from'))!;
  await panel.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(panel.getByText('Page 2 · 2 rows · Partial results')).toBeVisible();
  const next = state.requested.at(-1)!;
  expect(next.searchParams.get('from')).toBe(first.searchParams.get('from'));
  expect(next.searchParams.get('to')).toBe(first.searchParams.get('to'));
  await panel.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(panel.getByText('Page 1 · 2 rows · Partial results')).toBeVisible();
  state.fail = true;
  await panel.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(panel.getByText('Observer is temporarily unavailable.', { exact: false })).toBeVisible();
  state.fail = false;
  await panel.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(panel.locator('.association-card')).toHaveCount(2);
  await panel.getByLabel('Filter by full producing address').fill('AlienApeZ');
  await panel.getByRole('button', { name: 'Apply filter' }).click();
  await expect(panel.getByRole('alert')).toContainText('full z1 producing address');
});

test('stale and failed associations retain timestamps and retry independently with backoff', async ({ page }) => {
  test.skip(disabled);
  const state = await setup(page); state.stale = true; await page.goto('/#observer');
  const panel = page.locator('#observer');
  await expect(panel.locator('.association-card')).toHaveCount(2);
  await expect(panel.locator('.association-evidence').getByText('this snapshot is stale', { exact: false })).toBeVisible();
  const generated = await panel.locator('.association-evidence .observer-metadata time').textContent();
  state.fail = true;
  await page.clock.runFor(31000);
  await expect(panel.locator('.association-evidence').getByText('Last successful observations are retained below.', { exact: false })).toBeVisible();
  await expect(panel.locator('.association-card')).toHaveCount(2);
  expect(await panel.locator('.association-evidence .observer-metadata time').textContent()).toBe(generated);
  const calls = state.requested.filter(u => u.pathname.endsWith('associations')).length;
  await page.clock.runFor(30000);
  expect(state.requested.filter(u => u.pathname.endsWith('associations')).length).toBe(calls);
  state.fail = false; state.stale = false;
  await page.clock.runFor(31000);
  await expect(panel.locator('.association-evidence').getByText('temporarily unavailable', { exact: false })).toHaveCount(0);
  await expect(page.locator('#momentums h2')).toHaveText('Momentum watch');
});

test('nullable arrival eligibility and null pillar windows render without inventing dates', async ({ page }) => {
  test.skip(disabled);
  await setup(page); await page.goto('/#observer');
  const panel = page.locator('#observer');
  await panel.getByRole('tab', { name: 'Checked momentums' }).click();
  await panel.getByRole('button', { name: /^Expand momentum/ }).first().click();
  await expect(panel.getByText('No complete association hours in this raw-history window.')).toBeVisible();
  await expect(panel.getByText('Eligibility determined by comparison window', { exact: false }).first()).toBeVisible();
  await expect(panel).not.toContainText('Invalid Date');
  await expect(panel).not.toContainText('1970');
});

test('legacy collection-only service remains readable', async ({ page }) => {
  test.skip(disabled);
  const state = await setup(page); state.legacy = true; await page.goto('/#observer');
  await expect(page.locator('#observer').getByText('Association analysis pending.', { exact: false })).toBeVisible();
  expect(state.requested.filter(u => u.pathname.endsWith('associations')).every(u => !u.searchParams.has('from'))).toBeTruthy();
  const panel = page.locator('#observer');
  await panel.getByRole('tab', { name: 'Checked momentums' }).click();
  await panel.getByRole('button', { name: /^Expand momentum/ }).first().click();
  await expect(panel.getByText('Association analysis is unavailable from this legacy collector.')).toBeVisible();
});

test('responsive evidence has no body overflow and exposes details on desktop and mobile', async ({ page }, info) => {
  test.skip(disabled);
  await setup(page); await page.goto('/#observer');
  const panel = page.locator('#observer'); await expect(panel.locator('.association-card')).toHaveCount(2);
  await panel.locator('.association-card').first().locator('summary').click();
  await expect(panel.getByText('Producer software version', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await panel.locator('.association-card').first().locator('summary').click();
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `.qa/associations-${info.project.name}.png`, fullPage: true });
  await panel.screenshot({ path: `.qa/observer-associations-${info.project.name}.png` });
});

test('disabled flag renders no Observer or pillar evidence and sends no Observer requests', async ({ page }) => {
  test.skip(!disabled);
  const state = await setup(page); await page.goto('/');
  await expect(page.locator('#momentums h2')).toHaveText('Momentum watch');
  await page.clock.runFor(65000);
  await expect(page.locator('#observer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View relay evidence' })).toHaveCount(0);
  expect(state.requested).toHaveLength(0);
});

test('live Observer integration uses current responses and the production CORS origin', async ({ page, request }, info) => {
  test.skip(disabled || process.env.CHECK_LIVE_OBSERVER !== '1');
  test.setTimeout(90000);
  const status = await request.get(`${api}/api/v1/status`, { headers: { Origin: 'https://0x3639.com' } });
  expect(status.ok()).toBeTruthy(); expect(status.headers()['access-control-allow-origin']).toBe('https://0x3639.com');
  const body = await status.json(); expect(body.schemaVersion).toBe('1.1'); expect(body.methodVersion).toBe('association-2');
  const responses: { path: string; status: number }[] = [];
  // Preview-only transport: production permits 0x3639.com, not the local preview origin.
  for (const origin of [api, discovery]) await page.route(`${origin}/**`, async route => {
    const response = await route.fetch({ timeout: 20000, headers: { Origin: 'https://0x3639.com' } });
    responses.push({ path: route.request().url(), status: response.status() });
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': route.request().headers().origin || '*' } });
  });
  await page.goto('/#observer');
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
  const panel = page.locator('#observer');
  await expect(panel.locator('.association-card').first()).toBeVisible({ timeout: 25000 });
  await expect(panel.getByText('Comparison summaries available', { exact: true })).toBeVisible();
  await expect(panel).not.toContainText('Unable to read this Observer feed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await panel.evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `.qa/live-observer-${info.project.name}.png` });
  await panel.locator('.association-evidence').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `.qa/live-associations-${info.project.name}.png` });
  const first = panel.locator('.association-card').first();
  const producingAddress = (await first.locator('.association-address').textContent())!;
  await panel.getByLabel('Filter by full producing address').fill(producingAddress);
  await panel.getByRole('button', { name: 'Apply filter' }).click();
  await expect(first).toBeVisible();
  for (const address of await panel.locator('.association-card .association-address').allTextContents()) expect(address).toBe(producingAddress);
  await panel.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(panel.getByText('Page 2', { exact: false })).toBeVisible();
  await expect(first).toBeVisible();
  await panel.getByRole('tab', { name: 'Checked momentums' }).click();
  await panel.getByRole('button', { name: /^Expand momentum/ }).first().click();
  await expect(panel.getByText('Eligibility determined by comparison window', { exact: false }).first()).toBeVisible({ timeout: 20000 });
  const momentum = page.locator('#momentums');
  await expect(momentum.getByRole('button', { name: 'View relay evidence' })).toBeVisible();
  await momentum.getByRole('button', { name: 'View relay evidence' }).click();
  await expect(momentum.locator('.association-card').first()).toBeVisible({ timeout: 25000 });
  await momentum.locator('.pillar-relay-evidence').evaluate(el => el.scrollIntoView({ block: 'start' }));
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 1450 });
  await momentum.locator('.pillar-relay-evidence').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `.qa/live-pillar-${info.project.name}.png` });
  await momentum.locator('.association-card').first().screenshot({ path: `.qa/live-relay-card-${info.project.name}.png` });
  await info.attach('live-requests', { body: JSON.stringify({ generatedAt: body.generatedAt, schemaVersion: body.schemaVersion, methodVersion: body.methodVersion, responses }, null, 2), contentType: 'application/json' });
});
