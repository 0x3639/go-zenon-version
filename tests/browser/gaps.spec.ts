import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const gapFixture = JSON.parse(readFileSync(new URL('../fixtures/gaps.json', import.meta.url), 'utf8'));
const production = JSON.parse(readFileSync(new URL('../fixtures/production.json', import.meta.url), 'utf8'));
const api = 'https://tw7v2v7y9rjq7mle1isnlktq.172.245.238.165.sslip.io';
async function setup(page: Page) {
  await page.clock.install({ time: new Date(gapFixture.generatedAt) });
  const state = { data: structuredClone(gapFixture), fail: 0, calls: 0 };
  await page.route(`${api}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/production/gaps') { state.calls++; return state.fail ? route.fulfill({ status: state.fail, body: '{}' }) : route.fulfill({ json: state.data }); }
    if (path === '/api/v1/production') return route.fulfill({ json: production });
    return route.fulfill({ status: 503, body: '{}' });
  });
  return state;
}
test('study comparison, later production, audit and responsive layout', async ({ page }, info) => {
  const state = await setup(page); await page.goto('/#pillars');
  expect(state.calls).toBe(0); await page.getByRole('button', { name: 'Why the gaps?' }).click();
  const panel = page.locator('.gap-study'); await expect(panel).toContainText('Baseline nonproducers missed more slots');
  await expect(panel.locator('.gap-cohorts')).toContainText('50.0%');
  await expect(panel.locator('tr').filter({ hasText: 'Recovered producer' })).toContainText('No production in baseline');
  await expect(panel.locator('tr').filter({ hasText: 'Recovered producer' }).locator('[data-label="Produced"]')).toHaveText('60');
  await expect(panel).toContainText('It does not prove those pillars are on another fork');
  await panel.getByText('How we test this, and what remains unknown').click(); await expect(panel).toContainText('Matching produced slots does not independently verify assignments to empty slots');
  await panel.getByText('Round-by-round evidence · 6 of 6 included').click(); await expect(panel.locator('.gap-round')).toHaveCount(6);
  await page.getByLabel('Search study pillars').fill(gapFixture.pillars[1].producer); await expect(panel.locator('tbody tr')).toHaveCount(1); await page.getByLabel('Search study pillars').fill('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await panel.screenshot({ path: `.qa/gaps-fixture-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Pillars', exact: true }).click(); const calls = state.calls; await page.clock.fastForward(60000); expect(state.calls).toBe(calls);
});
test('failure keeps timestamp, backs off and leaves production independent', async ({ page }) => {
  const state = await setup(page); await page.goto('/#pillars'); await page.getByRole('button', { name: 'Why the gaps?' }).click();
  const panel = page.locator('.gap-study'); await expect(panel.locator('.gap-badge')).toHaveText('Fresh study');
  const stamp = await panel.locator('.gap-source').textContent(); state.fail = 503; await page.clock.fastForward(30000);
  await expect(panel.getByRole('status')).toContainText('HTTP 503'); await expect(panel).toContainText('Historical comparison only'); await expect(panel.locator('.gap-source')).toHaveText(stamp!);
  const calls = state.calls; await page.clock.fastForward(30000); expect(state.calls).toBe(calls); await page.clock.fastForward(30000); await expect.poll(() => state.calls).toBe(calls + 1);
  await page.getByRole('button', { name: 'Pillars', exact: true }).click(); await expect(page.locator('.pillar-production-table tbody tr')).toHaveCount(3);
});
test('null windows, insufficient comparisons and stale data are explicit', async ({ page }) => {
  const state = await setup(page); state.data.status = 'waiting'; state.data.windowStart = state.data.windowEnd = null; state.data.rounds = []; state.data.pillars = [];
  for (const key of ['all', 'comparable', 'noBaselineProduction', 'priorProduction']) state.data[key] = { scheduled: 0, produced: 0, missed: 0 };
  await page.goto('/#pillars'); await page.getByRole('button', { name: 'Why the gaps?' }).click();
  await expect(page.locator('.gap-study')).toContainText('Waiting for a later comparison window');
  state.data = structuredClone(gapFixture); state.data.rounds = state.data.rounds.slice(0, 1); state.data.windowEnd = state.data.windowStart + 300;
  for (const key of ['all', 'comparable', 'noBaselineProduction', 'priorProduction']) for (const c of ['scheduled', 'produced', 'missed']) state.data[key][c] /= 6;
  for (const p of state.data.pillars) for (const c of ['scheduled', 'produced', 'missed']) p[c] /= 6;
  await page.clock.fastForward(30000); await expect(page.locator('.gap-study')).toContainText('Not enough comparable slots yet');
  state.data.status = 'stale'; await page.clock.fastForward(30000); await expect(page.locator('.gap-study')).toContainText('Historical comparison only');
});
test('older discovery backend requires deployment only for the study', async ({ page }) => {
  const state = await setup(page); state.fail = 404; await page.goto('/#pillars'); await page.getByRole('button', { name: 'Why the gaps?' }).click();
  await expect(page.locator('.gap-study')).toContainText('discovery service needs the new deployment');
  await page.getByRole('button', { name: 'Momentum timing' }).click(); await expect(page.locator('.timing-table tbody tr')).toHaveCount(3);
});
test('live-size result paginates locally without extra requests', async ({ page }) => {
  const state = await setup(page);
  state.data = JSON.parse(readFileSync(new URL('../fixtures/gaps-live.json', import.meta.url), 'utf8'));
  await page.goto('/#pillars'); await page.getByRole('button', { name: 'Why the gaps?' }).click();
  const panel = page.locator('.gap-study'); await expect(panel.locator('tbody tr')).toHaveCount(10);
  const first = await panel.locator('tbody tr').first().textContent(), calls = state.calls;
  await panel.getByRole('button', { name: 'Next study pillars' }).click();
  await expect(panel.locator('tbody tr').first()).not.toHaveText(first!);
  await expect(panel).toContainText('page 2 of 10'); expect(state.calls).toBe(calls);
  await panel.getByRole('button', { name: 'Previous study pillars' }).click();
  await expect(panel.locator('tbody tr').first()).toHaveText(first!);
});
