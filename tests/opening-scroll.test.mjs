import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/site.js', import.meta.url), 'utf8');

// Drive the browser lifecycle independently of network and frame timing.
function browser({ hidden = false, hash = '', y = 0, navigation = 'navigate', reduced = false, readyState = 'loading' } = {}) {
  const window = new EventTarget();
  const document = new EventTarget();
  const motion = Object.assign(new EventTarget(), { matches: reduced });
  let fontsLoaded;
  document.fonts = { ready: new Promise(resolve => { fontsLoaded = resolve; }) };
  Object.assign(document, { hidden, readyState, documentElement: { scrollHeight: 2400 } });
  const poster = Object.assign(new EventTarget(), { offsetHeight: 1000, style: { setProperty() {}, removeProperty() {} } });
  const frames = new Map();
  const positions = [];
  let frame = 0;
  let now = 0;
  const context = {
    document, location: { hash }, scrollY: y, innerHeight: 800, AbortController,
    matchMedia: () => motion,
    addEventListener: window.addEventListener.bind(window),
    requestAnimationFrame(callback) { frames.set(++frame, callback); return frame; },
    cancelAnimationFrame(id) { frames.delete(id); },
    performance: { now: () => now, getEntriesByType: () => [{ type: navigation }] },
    scrollTo({ top }) { positions.push(top); context.scrollY = top; }
  };
  document.querySelector = selector => selector === '.poster' ? poster : {
    getBoundingClientRect: () => ({ top: 600 - context.scrollY, height: 200 })
  };
  document.querySelectorAll = () => [];
  document.getElementById = () => null;
  runInNewContext(source, context);
  return {
    positions, context,
    async layoutReady() {
      document.readyState = 'interactive';
      document.dispatchEvent(new Event('DOMContentLoaded'));
      fontsLoaded();
      await Promise.resolve();
    },
    frames(count = 40) {
      for (let i = 0; i < count; i++) {
        now += 16;
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach(callback => callback(now));
      }
    },
    visible(value) {
      document.hidden = !value;
      document.dispatchEvent(new Event('visibilitychange'));
    },
    event(type) { window.dispatchEvent(new Event(type)); }
  };
}

test('first visit centers text after layout and fonts, before images finish loading', async () => {
  const page = browser();
  page.frames();
  assert.deepEqual(page.positions, []);
  await page.layoutReady();
  page.frames();
  assert.equal(page.context.scrollY, 300);
});

test('a background first visit centers text when the tab becomes visible', async () => {
  const page = browser({ hidden: true });
  await page.layoutReady();
  await page.event('pageshow');
  page.frames();
  assert.deepEqual(page.positions, []);
  page.visible(true);
  page.frames();
  assert.equal(page.context.scrollY, 300);
});

test('switching tabs while layout is pending does not cancel the opening scroll', async () => {
  const page = browser();
  page.visible(false);
  await page.layoutReady();
  page.visible(true);
  page.frames();
  assert.equal(page.context.scrollY, 300);
});

test('switching tabs between layout frames waits for activation', async () => {
  const page = browser();
  await page.layoutReady();
  page.frames(1);
  page.visible(false);
  page.frames();
  assert.deepEqual(page.positions, []);
  page.visible(true);
  page.frames();
  assert.equal(page.context.scrollY, 300);
});

test('manual input cancels both pending and running opening scrolls', async () => {
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    for (const running of [false, true]) {
      const page = browser();
      await page.layoutReady();
      await page.event('pageshow');
      if (running) page.frames(5);
      if (running) assert.ok(page.positions.length > 0);
      page.event(type);
      const count = page.positions.length;
      page.visible(false);
      page.visible(true);
      page.frames();
      assert.equal(page.positions.length, count, `${type}, running=${running}`);
    }
  }
});

test('hiding a tab during animation stops it without restarting on return', async () => {
  const page = browser();
  await page.layoutReady();
  await page.event('pageshow');
  page.frames(5);
  assert.ok(page.context.scrollY > 0 && page.context.scrollY < 300);
  page.visible(false);
  const count = page.positions.length;
  page.visible(true);
  page.frames();
  assert.equal(page.positions.length, count);
});

test('reload centers only once and respects anchors, history, restored scroll and reduced motion', async () => {
  const reload = browser({ navigation: 'reload', readyState: 'complete' });
  await reload.layoutReady();
  await reload.event('pageshow');
  reload.frames();
  assert.equal(reload.context.scrollY, 300);
  const count = reload.positions.length;
  reload.visible(false);
  reload.visible(true);
  await reload.event('pageshow');
  reload.frames();
  assert.equal(reload.positions.length, count);
  for (const options of [{ hash: '#work' }, { navigation: 'back_forward' }, { y: 500 }, { reduced: true }]) {
    const page = browser(options);
    await page.layoutReady();
    await page.event('pageshow');
    page.frames();
    assert.deepEqual(page.positions, []);
  }
});

test('leaving a pending page prevents a delayed scroll after history restoration', async () => {
  const page = browser();
  page.event('pagehide');
  await page.layoutReady();
  page.visible(true);
  await page.event('pageshow');
  page.frames();
  assert.deepEqual(page.positions, []);
});
