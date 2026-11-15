import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync(new URL('../fixtures/production.json', import.meta.url), 'utf8'));
const api = 'https://tw7v2v7y9rjq7mle1isnlktq.172.245.238.165.sslip.io';
const observer = 'zsjo46q7s0qcmaklbmak7gfp';
async function setup(page: Page) {
  await page.clock.install({ time: new Date(fixture.generatedAt) });
  const state = { data: structuredClone(fixture), fail: false, old: false, calls: [] as string[], observerCalls: [] as string[] };
  page.on('request', r => { if (r.url().includes(observer)) state.observerCalls.push(r.url()); });
  await page.route(`${api}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/production') { state.calls.push(url.toString()); return state.fail ? route.fulfill({ status: state.old ? 404 : 503, body: '{}' }) : route.fulfill({ json: state.data }); }
    if (url.pathname === '/api/v1/production/momentums') {
      state.calls.push(url.toString()); const before = Number(url.searchParams.get('beforeHeight'));
      return route.fulfill({ json: { schemaVersion: 1, tipHeight: Number(url.searchParams.get('tipHeight')), tipHash: url.searchParams.get('tipHash'), data: fixture.recent.filter((m: any) => m.height < before), nextBeforeHeight: null } });
    }
    if (url.pathname.endsWith('/momentums')) {
      const unix = Date.parse(fixture.generatedAt) / 1000 - 1, genesis = 1637755200;
      const slots = Array.from({ length: 30 }, (_, i) => { const startsAt = unix + 10 + i * 10, since = startsAt - genesis; return { round: Math.floor(since / 300), index: Math.floor(since % 300 / 10) + 1, startsAt, pillar: 'Alpha', producer: fixture.pillars[0].producer, software: { version: null, reason: 'no-pillar-peer-link' } }; });
      return route.fulfill({ json: { schemaVersion: 1, generatedAt: fixture.generatedAt, status: 'ready', source: 'wss://reference.example', basis: 'rpc-current-weights', genesis, slotSeconds: 10, checked: 120, matched: 117, frontier: fixture.frontier, rounds: [], slots } });
    }
    return route.fulfill({ status: 503, body: '{}' });
  });
  return state;
}
test('pillar list, one-hour flags, actual intervals and removed Observer on desktop and mobile', async ({ page }, info) => {
  const state = await setup(page); await page.goto('/#pillars'); const panel = page.locator('#pillars');
  await expect(panel.getByRole('heading', { name: 'Pillar production' })).toBeVisible();
  await expect(panel.locator('tbody tr')).toHaveCount(3);
  await expect(panel.locator('tbody tr').filter({ hasText: 'Quiet' })).toContainText('Possibly forked out');
  await expect(panel).toContainText('9:49 AM CST');
  await expect(page.locator('#observer')).toHaveCount(0); await expect(page.getByRole('button', { name: 'View relay evidence' })).toHaveCount(0);
  await expect(page.getByText(/differ from this reconstruction/)).toHaveCount(0);
  await expect(page.locator('.slot-inspector')).toContainText('Version unknown');
  await page.getByLabel('Filter pillar production').selectOption('flagged'); await expect(panel.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('Filter pillar production').selectOption('all'); await page.getByLabel('Search pillars').fill(fixture.pillars[1].producer); await expect(panel.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('Search pillars').fill('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await panel.screenshot({ path: `.qa/production-pillars-${info.project.name}.png` });
  await panel.getByRole('button', { name: 'Momentum timing' }).click();
  await expect(panel.locator('tbody tr')).toHaveCount(3); await expect(panel.locator('tbody tr').first()).toContainText('30s'); await expect(panel.locator('tbody tr').first()).toContainText('+20s');
  await expect(panel).toContainText('not computing time or network arrival delay');
  await panel.screenshot({ path: `.qa/production-timing-${info.project.name}.png` });
  expect(state.observerCalls).toEqual([]);
});
test('partial and stale history never label a pillar forked out; failed refresh preserves timestamp', async ({ page }) => {
  const state = await setup(page); state.data.complete = false; state.data.status = 'backfilling'; state.data.remaining = 50; state.data.frontier.height += 50;
  await page.goto('/#pillars'); const panel = page.locator('#pillars');
  await expect(panel).toContainText('Partial totals: 3 momentums checked; 50 still to load');
  await expect(panel.locator('tbody tr').filter({ hasText: 'Quiet' })).toContainText('Not assessed');
  state.data = structuredClone(fixture); await page.clock.fastForward(30000); await expect(panel.locator('tbody')).toContainText('Possibly forked out');
  const checked = await panel.locator('.production-source').textContent(); state.fail = true; await page.clock.fastForward(30000);
  await expect(panel.getByRole('status')).toContainText('HTTP 503'); await expect(panel.locator('.production-source')).toHaveText(checked!);
  await expect(panel.locator('tbody')).not.toContainText('Possibly forked out');
  const count = state.calls.length; await page.clock.fastForward(30000); expect(state.calls.length).toBe(count);
  await page.clock.fastForward(30000); await expect.poll(() => state.calls.length).toBe(count + 1);
});
test('older backend is independent of the existing schedule and peer dashboard', async ({ page }) => {
  const state = await setup(page); state.fail = true; state.old = true; await page.goto('/#pillars');
  await expect(page.locator('#pillars')).toContainText('discovery service needs the new deployment');
  await expect(page.locator('#momentums')).toContainText('Alpha'); await expect(page.locator('#peers')).toBeAttached(); expect(state.observerCalls).toEqual([]);
});
test('paging pins the tip while new snapshots arrive', async ({ page }) => {
  const state = await setup(page); state.data.recent = state.data.recent.slice(0, 1);
  await page.goto('/#pillars'); const panel = page.locator('#pillars'); await panel.getByRole('button', { name: 'Momentum timing' }).click();
  await panel.getByRole('button', { name: 'Older momentums' }).click();
  await expect(panel).toContainText('Browsing saved history through #103'); await expect(panel.locator('tbody tr').first()).toContainText('#102');
  const query = new URL(state.calls.find(c => c.includes('beforeHeight'))!); expect(query.searchParams.get('tipHeight')).toBe('103'); expect(query.searchParams.get('tipHash')).toBe(fixture.last.hash);
  state.data = structuredClone(fixture); await page.clock.fastForward(30000); await expect(panel.locator('tbody tr').first()).toContainText('#102');
  await panel.getByRole('button', { name: 'Return to latest' }).click(); await expect(panel.locator('tbody tr').first()).toContainText('#103');
});
