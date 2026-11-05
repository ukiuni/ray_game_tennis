import { test, expect } from '@playwright/test';

/** Press & release inside the page so the hold time is exact. */
async function press(page, id, x, y, ms) {
  await page.evaluate(({ id, x, y, ms }) => new Promise((resolve) => {
    const o = { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch' };
    document.elementFromPoint(x, y).dispatchEvent(new PointerEvent('pointerdown', o));
    setTimeout(() => {
      window.__pressedClass = document.getElementById('swing-btn').className;
      window.dispatchEvent(new PointerEvent('pointerup', o));
      resolve();
    }, ms);
  }), { id, x, y, ms });
}

async function touch(page, type, id, x, y) {
  await page.evaluate(({ type, id, x, y }) => {
    const el = document.elementFromPoint(x, y) || document.body;
    const target = type === 'pointerdown' ? el : window;
    const ev = new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: id === 1 });
    target.dispatchEvent(ev);
  }, { type, id, x, y });
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('./');
  await expect(page.locator('#title')).toBeVisible();
});

test('renders WebGL 3D scene and title screen', async ({ page }) => {
  const info = await page.evaluate(() => {
    const c = document.getElementById('game');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return { hasGl: !!gl, w: c.width, h: c.height };
  });
  expect(info.hasGl).toBe(true);
  expect(info.w).toBeGreaterThan(100);
  await expect(page.locator('.logo')).toContainText('ドットテニス');
});

test('PWA: manifest, icons and service worker', async ({ page, request }) => {
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const res = await request.get(href);
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe('fullscreen');
  for (const icon of m.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  expect((await request.get('apple-touch-icon.png'.replace(/^/, 'icons/'))).ok()).toBe(true);
  const sw = await request.get('sw.js');
  expect(sw.ok()).toBe(true);
  const swText = await sw.text();
  expect(swText).not.toContain('__VERSION__');
  expect(swText).not.toMatch(/self\.skipWaiting\(\);?\s*\n\s*event\.waitUntil/); // no auto skipWaiting at install
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return !!r.active;
  });
  expect(reg).toBe(true);
});

test('joystick moves the player and swing button hits the ball (touch)', async ({ page }) => {
  await page.locator('#btn-start').click();
  await expect(page.locator('#controls')).toBeVisible();
  const vp = page.viewportSize();
  const before = await page.evaluate(() => ({ ...window.__tennis.app.match.player.pos }));
  // drag joystick to the right on the left half
  const jx = vp.width * 0.2, jy = vp.height * 0.7;
  await touch(page, 'pointerdown', 1, jx, jy);
  await touch(page, 'pointermove', 1, jx + 50, jy);
  await page.waitForTimeout(400);
  await touch(page, 'pointerup', 1, jx + 50, jy);
  const after = await page.evaluate(() => ({ ...window.__tennis.app.match.player.pos }));
  expect(after.x).toBeGreaterThan(before.x + 0.3);

  // serve with a long press on the right half -> strong
  const bx = vp.width * 0.85, by = vp.height * 0.7;
  await press(page, 2, bx, by, 500);
  expect(await page.evaluate(() => window.__pressedClass)).toContain('strong');
  await expect.poll(() => page.evaluate(() => window.__tennis.app.match.phase)).toBe('rally');
  const v = await page.evaluate(() => window.__tennis.app.match.ball.vel);
  expect(v.z).toBeLessThan(0);
});

test('short press = weak swing, long press = strong swing', async ({ page }) => {
  await page.locator('#btn-start').click();
  const vp = page.viewportSize();
  const bx = vp.width * 0.85, by = vp.height * 0.7;
  const powers = await page.evaluate(() => {
    window.__swings = [];
    const m = window.__tennis.app.match;
    const orig = m.events.push.bind(m.events);
    m.events.push = (e) => { if (e.type === 'swing' || (e.type === 'hit' && e.who === 'player')) window.__swings.push(e.power); return orig(e); };
    return true;
  });
  expect(powers).toBe(true);
  await press(page, 3, bx, by, 60);
  await expect.poll(() => page.evaluate(() => window.__swings.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__swings[0])).toBe(0);
});

test('winning auto-starts the next game until losing', async ({ page }) => {
  await page.locator('#btn-start').click();
  await expect(page.locator('#hud-stage')).toHaveText('STAGE 1');
  await page.evaluate(() => window.__tennis.forceMatchEnd('player'));
  await expect(page.locator('#win')).toBeVisible();
  await expect(page.locator('#win-streak')).toHaveText('1');
  // no input: next game starts automatically
  await expect(page.locator('#hud-stage')).toHaveText('STAGE 2', { timeout: 6000 });
  await expect(page.locator('#win')).toBeHidden();
  expect(await page.evaluate(() => window.__tennis.state)).toBe('playing');
  expect(await page.evaluate(() => window.__tennis.app.match.server)).toBe('cpu');
  await page.evaluate(() => window.__tennis.forceMatchEnd('player'));
  await expect(page.locator('#hud-stage')).toHaveText('STAGE 3', { timeout: 6000 });
  await page.evaluate(() => window.__tennis.forceMatchEnd('cpu'));
  await expect(page.locator('#over')).toBeVisible();
  await expect(page.locator('#over-streak')).toHaveText('2');
  await expect(page.locator('#over-best')).toHaveText('2');
  await page.waitForTimeout(3500);
  expect(await page.evaluate(() => window.__tennis.state)).toBe('gameover'); // stops after a loss
  await page.locator('#btn-retry').click();
  await expect(page.locator('#hud-stage')).toHaveText('STAGE 1');
});

test('an actual rally plays out in the browser (AI vs simple input)', async ({ page }) => {
  await page.locator('#btn-start').click();
  // wait for the point to resolve without input: CPU wins points when we never return
  const vp = page.viewportSize();
  await press(page, 4, vp.width * 0.85, vp.height * 0.7, 60);
  await expect.poll(() => page.evaluate(() => window.__tennis.app.match.score.player + window.__tennis.app.match.score.cpu), { timeout: 15000 }).toBeGreaterThan(0);
});
