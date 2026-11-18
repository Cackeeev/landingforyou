import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/site.js', import.meta.url), 'utf8');

function page({ observer = true } = {}) {
  const window = new EventTarget();
  const motion = Object.assign(new EventTarget(), { matches: false });
  const poster = new EventTarget();
  const properties = new Map();
  const metrics = { reads: 0, writes: 0 };
  let height = 1000;
  let resized;
  let frame = 0;
  const frames = new Map();
  Object.defineProperty(poster, 'offsetHeight', { get() { metrics.reads++; return height; } });
  poster.style = {
    setProperty(name, value) { properties.set(name, value); metrics.writes++; },
    removeProperty(name) { properties.delete(name); }
  };
  const context = {
    document: { querySelector: () => poster, querySelectorAll: () => [], getElementById: () => null },
    // Isolate continuous scroll motion from the separate opening animation.
    location: { hash: '#contact' }, scrollY: 0,
    matchMedia: () => motion,
    addEventListener: window.addEventListener.bind(window),
    requestAnimationFrame(callback) { frames.set(++frame, callback); return frame; }
  };
  if (observer) context.ResizeObserver = class {
    constructor(callback) { resized = callback; }
    observe(target) { assert.equal(target, poster); }
  };
  runInNewContext(source, context);
  function flush() {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback());
  }
  return {
    metrics,
    motion: () => properties.get('--poster-motion'),
    reset() { metrics.reads = 0; metrics.writes = 0; },
    scroll(y) {
      context.scrollY = y;
      window.dispatchEvent(new Event('scroll'));
      flush();
    },
    resize(value) {
      height = value;
      if (observer) resized?.();
      else window.dispatchEvent(new Event('resize'));
      flush();
    },
    viewportResize() { window.dispatchEvent(new Event('resize')); flush(); },
    reduced(value) { motion.matches = value; motion.dispatchEvent(new Event('change')); flush(); }
  };
}

test('inertial scrolling and repeated notifications below the hero do no layout reads or style writes', () => {
  const view = page();
  view.scroll(1500);
  assert.equal(view.motion(), '1.0000');
  view.reset();
  for (let y = 1500; y <= 3500; y += 25) view.scroll(y);
  for (let i = 0; i < 60; i++) view.scroll(3500);
  view.viewportResize();
  assert.deepEqual(view.metrics, { reads: 0, writes: 0 });
});

test('scrolling back to the hero restores animation and clamps top overscroll', () => {
  const view = page();
  view.scroll(3000);
  view.scroll(500);
  assert.equal(view.motion(), '0.5000');
  view.scroll(-40);
  assert.equal(view.motion(), '0.0000');
  view.reset();
  view.scroll(-10);
  view.scroll(0);
  assert.deepEqual(view.metrics, { reads: 0, writes: 0 });
});

test('hero resize and orientation change update motion without measuring during scroll', () => {
  for (const observer of [true, false]) {
    const view = page({ observer });
    view.scroll(500);
    view.resize(2000);
    assert.equal(view.motion(), '0.2500');
    view.reset();
    view.scroll(1000);
    assert.equal(view.motion(), '0.5000');
    assert.equal(view.metrics.reads, 0);
  }
});

test('reduced motion resets animation and avoids repeated updates during scrolling', () => {
  const view = page();
  view.scroll(500);
  view.reduced(true);
  assert.equal(view.motion(), '0.0000');
  view.reset();
  view.scroll(700);
  view.scroll(1500);
  assert.deepEqual(view.metrics, { reads: 0, writes: 0 });
  view.reduced(false);
  assert.equal(view.motion(), '1.0000');
});
