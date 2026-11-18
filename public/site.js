
const poster = document.querySelector('.poster');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let frame = 0;

function updateScroll() {
  frame = 0;
  const progress = reducedMotion.matches ? 0 : Math.max(0, Math.min(1, scrollY / poster.offsetHeight));
  poster.style.setProperty('--poster-motion', progress.toFixed(4));
}

function scheduleScroll() {
  if (!frame) frame = requestAnimationFrame(updateScroll);
}

addEventListener('scroll', scheduleScroll, { passive: true });
addEventListener('resize', scheduleScroll);
reducedMotion.addEventListener('change', scheduleScroll);
updateScroll();

poster.addEventListener('pointermove', event => {
  if (reducedMotion.matches || event.pointerType === 'touch') return;
  const rect = poster.getBoundingClientRect();
  const position = (event.clientX - rect.left) / rect.width;
  poster.style.setProperty('--headline-shift', position.toFixed(3));
});
poster.addEventListener('pointerleave', () => poster.style.removeProperty('--headline-shift'));

document.querySelectorAll('.poster-footer a').forEach(link => {
  link.addEventListener('click', () => {
    const section = document.querySelector(link.hash);
    if (section) section.open = true;
  });
});
document.querySelectorAll('[data-open]').forEach(button => {
  button.addEventListener('click', () => document.getElementById(button.dataset.open).showModal());
});
const requestForm = document.getElementById('request-form');
if (requestForm) requestForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = requestForm.querySelector('button');
  const status = requestForm.querySelector('[role=status]');
  button.disabled = true;
  status.textContent = 'Отправляем…';
  try {
    const response = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(requestForm)))
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    status.textContent = 'Заявка сохранена. Можно также написать напрямую в Telegram.';
    requestForm.reset();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

// Center the opening copy once, yielding immediately to visitor input.
function prepareOpeningScroll() {
  if (location.hash || scrollY > 1 || reducedMotion.matches) return;
  const navigation = performance.getEntriesByType('navigation')[0];
  if (navigation?.type === 'back_forward') return;

  const controller = new AbortController();
  let animation = 0;
  let cancelled = false;
  let ready = false;
  let scheduled = false;
  let started = false;
  function cancelOpeningScroll() {
    cancelled = true;
    cancelAnimationFrame(animation);
    controller.abort();
  }
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    addEventListener(type, cancelOpeningScroll, {
      capture: true,
      passive: true,
      signal: controller.signal
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (started) {
      cancelOpeningScroll();
      return;
    }
    // A new tab can load in the background. Wait for its first visible frame.
    cancelAnimationFrame(animation);
    scheduled = false;
    scheduleOpeningScroll();
  }, { signal: controller.signal });
  addEventListener('pagehide', cancelOpeningScroll, { once: true, signal: controller.signal });
  reducedMotion.addEventListener('change', cancelOpeningScroll, { signal: controller.signal });

  function scheduleOpeningScroll() {
    if (!ready || scheduled || cancelled || document.hidden) return;
    scheduled = true;
    animation = requestAnimationFrame(() => {
      animation = requestAnimationFrame(() => {
        scheduled = false;
        if (cancelled || scrollY > 1 || location.hash || reducedMotion.matches) {
          cancelOpeningScroll();
          return;
        }
        if (document.hidden) return;
        const copy = document.querySelector('.poster-copy').getBoundingClientRect();
        const target = Math.min(
          document.documentElement.scrollHeight - innerHeight,
          Math.max(0, scrollY + copy.top + copy.height / 2 - innerHeight / 2)
        );
        if (target < 2) {
          controller.abort();
          return;
        }
        started = true;
        const start = performance.now();
        function advance(now) {
          if (cancelled) return;
          const progress = Math.min(1, (now - start) / 420);
          const eased = 1 - Math.pow(1 - progress, 3);
          scrollTo({ top: target * eased, behavior: 'instant' });
          if (progress < 1) animation = requestAnimationFrame(advance);
          else controller.abort();
        }
        animation = requestAnimationFrame(advance);
      });
    });
  }

  function prepareLayout() {
    // The hero has fixed image dimensions; other images need not delay it.
    document.fonts.ready.then(() => {
      ready = true;
      scheduleOpeningScroll();
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', prepareLayout, { once: true, signal: controller.signal });
  } else {
    prepareLayout();
  }
}
prepareOpeningScroll();
