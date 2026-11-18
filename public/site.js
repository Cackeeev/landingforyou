
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
