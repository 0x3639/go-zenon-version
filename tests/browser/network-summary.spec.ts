import { test, expect } from '@playwright/test';
const discovery = 'https://tw7v2v7y9rjq7mle1isnlktq.172.245.238.165.sslip.io';
const observer = 'https://zsjo46q7s0qcmaklbmak7gfp.172.245.238.165.sslip.io';
const at = '2026-11-14T10:45:00Z';
const nodes = Array.from({ length: 166 }, (_, i) => {
  const version = i < 47 ? 'v0.0.10' : i < 59 ? 'v0.0.8' : i < 63 ? 'v0.0.9' : i === 63 ? 'v0.0.1' : null;
  return { id: (i + 1).toString(16).padStart(128, '0'), ip: `8.8.4.${i + 1}`, tcpPort: 35995,
    name: version ? `${version} znn-node` : '', version, evidence: i < 33 ? 'p2p' : i < 64 ? 'peer' : 'discovery',
    sources: [], rpcEndpoints: [], reportedVersions: version ? [version] : [], commit: null, firstSeen: at, lastSeen: at,
    handshake: { status: i < 33 ? 'confirmed' : 'failed', ip: `8.8.4.${i + 1}`, port: 35995, attemptedAt: at } };
});

test('referrals remain accessible without inflating overview or the newer observed version share', async ({ page }, info) => {
  await page.clock.install({ time: new Date(at) });
  const snapshot = { schemaVersion: 1, mode: 'discovery', generatedAt: at, nodes, sources: [],
    release: { version: 'v0.0.9', tag: 'v0.0.9-alphanet', url: 'https://github.com/zenon-network/go-zenon/releases/tag/v0.0.9-alphanet', checkedAt: at } };
  await page.route('**/data/network.json', route => route.fulfill({ json: snapshot }));
  await page.route(`${discovery}/**`, route => route.request().url().endsWith('/network') ? route.fulfill({ json: snapshot }) : route.fulfill({ status: 503, body: '{}' }));
  await page.route(`${observer}/**`, route => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/');
  const stats = page.getByRole('region', { name: 'Network statistics' });
  await expect(stats.locator('.stat').nth(0)).toContainText('64');
  await expect(stats.locator('.stat').nth(2)).toContainText('Highest observed version');
  await expect(stats.locator('.stat').nth(2)).toContainText('73');
  await expect(stats.locator('.stat').nth(2)).toContainText('v0.0.10');
  await expect(stats.locator('.stat').nth(2)).toContainText('47 of 64 peers with a known version');
  await expect(page.locator('.release-source')).toContainText('GitHub published release: v0.0.9');
  await expect(page.locator('.discovery-summary')).toContainText('102 discovery-only candidates');
  await expect(page.locator('#peers .count-label')).toHaveText('64');
  await expect(page.getByLabel('Filter by evidence')).toHaveValue('reported');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: `.qa/network-summary-${info.project.name}.png`, fullPage: true });
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
  await stats.evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `.qa/network-overview-${info.project.name}.png` });
  await page.getByRole('button', { name: 'View discovery candidates' }).click();
  await expect(page.locator('#peers .count-label')).toHaveText('102');
  await expect(page.locator('#peers .table-version').first()).toHaveText('Unknown');
  await page.getByLabel('Filter by evidence').selectOption('all');
  await expect(page.locator('#peers .count-label')).toHaveText('166');
  await page.getByLabel('Filter by evidence').selectOption('reported');
  await page.getByLabel('Filter by P2P connection').selectOption('failed');
  await expect(page.locator('#peers .count-label')).toHaveText('31');
});
