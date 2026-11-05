import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

/** Serves a private copy of dist/ so the test can "deploy" a new version. */
async function startDeploy() {
  const dir = mkdtempSync(join(tmpdir(), 'tennis-deploy-'));
  cpSync('dist', dir, { recursive: true });
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(dir, normalize(p));
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=600' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    publishNewVersion() {
      const f = join(dir, 'sw.js');
      writeFileSync(f, readFileSync(f, 'utf8').replace(/const VERSION = '([^']+)'/, "const VERSION = '$1-next'"));
    },
    close() {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function swVersion(page) {
  return page.evaluate(() => new Promise((r) => {
    navigator.serviceWorker.addEventListener('message', (e) => r(e.data.version), { once: true });
    navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' });
  }));
}

// Simulates "a new version is waiting" and checks it is never applied mid-game.
test('updates are deferred while playing and applied on the title screen', async ({ page, browserName }) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate(() => {
    window.__applied = 0;
    const u = window.__tennis.updater;
    u.deps.activate = () => { window.__applied++; };
  });
  await page.locator('#btn-start').click();
  await page.evaluate(() => window.__tennis.updater.onUpdateReady());
  await expect(page.locator('#toast')).toContainText('ゲーム終了後');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__applied)).toBe(0);
  // win -> auto next game: still not applied
  await page.evaluate(() => window.__tennis.forceMatchEnd('player'));
  await expect(page.locator('#hud-stage')).toHaveText('STAGE 2', { timeout: 6000 });
  expect(await page.evaluate(() => window.__applied)).toBe(0);
  // lose -> game over -> back to title: applied
  await page.evaluate(() => window.__tennis.forceMatchEnd('cpu'));
  expect(await page.evaluate(() => window.__applied)).toBe(0);
  await page.locator('#btn-title').click();
  await expect.poll(() => page.evaluate(() => window.__applied)).toBe(1);
  void browserName;
});

// Real service-worker update: a new version is deployed while the user is playing.
test('real SW update downloads in background and only activates outside a game', async ({ page }) => {
  const deploy = await startDeploy();
  try {
    await page.goto(deploy.url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // now controlled by the SW
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const v1 = await swVersion(page);

    await page.locator('#btn-start').click();
    await page.evaluate(() => { window.__marker = 'same-page'; });
    deploy.publishNewVersion();
    await page.evaluate(() => window.__tennis.updater.checkNow());
    await expect.poll(() => page.evaluate(() => window.__tennis.updater.pending), { timeout: 15000 }).toBe(true);
    await page.waitForTimeout(1500);
    // still the same page, still playing, old SW still in control
    expect(await page.evaluate(() => window.__marker)).toBe('same-page');
    expect(await page.evaluate(() => window.__tennis.state)).toBe('playing');
    expect(await swVersion(page)).toBe(v1);

    // winning -> next game starts automatically: still no update
    await page.evaluate(() => window.__tennis.forceMatchEnd('player'));
    await expect(page.locator('#hud-stage')).toHaveText('STAGE 2', { timeout: 6000 });
    expect(await page.evaluate(() => window.__marker)).toBe('same-page');

    // lose, go back to the title: update is applied (page reloads with the new SW)
    await page.evaluate(() => window.__tennis.forceMatchEnd('cpu'));
    await page.locator('#btn-title').click();
    await expect.poll(() => page.evaluate(() => window.__marker).catch(() => 'reloading'), { timeout: 15000 }).toBeUndefined();
    await expect(page.locator('#title')).toBeVisible();
    expect(await swVersion(page)).toBe(`${v1}-next`);
  } finally {
    deploy.close();
  }
});
