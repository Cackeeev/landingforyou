import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './store.mjs';

const template = readFileSync(resolve(root, 'templates/site.html'), 'utf8');
export function escape(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

export function renderSite(content) {
  const { settings } = content;
  const projects = content.projects.filter(project => project.status === 'published');
  const services = content.services.filter(service => service.status === 'published');
  const telegram = 'https://t.me/' + settings.telegram;
  const work = projects.map(project => `
    <button type="button" class="project-preview" data-open="case-${escape(project.id)}">
      <img src="${escape(project.image)}" alt="Логотип или изображение проекта «${escape(project.title)}»" loading="lazy">
      <span class="project-label">
        <span><small>${escape(project.category)}</small><span class="project-name">${escape(project.title)}</span></span>
        <span class="circle-arrow" aria-hidden="true">↗</span>
      </span>
    </button>`).join('');
  const cases = projects.map(project => `
    <dialog id="case-${escape(project.id)}" aria-labelledby="title-${escape(project.id)}">
      <form method="dialog"><button class="close" aria-label="Закрыть">×</button></form>
      <h2 id="title-${escape(project.id)}">${escape(project.title)}</h2>
      <img src="${escape(project.image)}" alt="${escape(project.title)}">
      <h3>Задача</h3><p>${escape(project.task)}</p>
      <h3>Результат</h3><p>${escape(project.description)}</p>
      ${project.technologies ? `<p class="case-tech">${escape(project.technologies)}</p>` : ''}
      ${project.url ? `<a class="button" href="${escape(project.url)}" target="_blank" rel="noopener">Открыть проект ↗</a>` : ''}
    </dialog>`).join('');
  const slots = {
    INTRO: escape(settings.intro), SUBTITLE: escape(settings.subtitle),
    HEADLINE: escape(settings.headline), HEADLINE2: escape(settings.headline2), HEADLINE3: escape(settings.headline3),
    TELEGRAM: escape(telegram), FEATURE_IMAGE: escape(projects[0]?.image || '/assets/baltic-logo.png'),
    WORK: `<section class="work pad" id="work" aria-labelledby="work-title">
      <div class="work-heading"><h2 class="section-heading" id="work-title">Работы</h2></div>${work}</section>`,
    SERVICES: `<section class="services pad" id="services" aria-labelledby="services-title">
      <h2 class="section-heading" id="services-title">Услуги</h2>
      ${services.map(service => `<details class="service" id="service-${escape(service.id)}">
        <summary>${escape(service.title)}</summary><p>${escape(service.description)}</p></details>`).join('')}
    </section>`,
    SERVICE_NAV: `<nav class="poster-footer" aria-label="Направления работы">${services.map(service =>
      `<a href="#service-${escape(service.id)}">${escape(service.nav || service.title)}</a>`).join('')}</nav>`,
    ABOUT: `<section class="process pad" id="process" aria-labelledby="process-title">
      <div><h2 class="section-heading" id="process-title">Обо мне</h2><p>${escape(settings.about)}</p></div>
      <ol aria-label="Этапы работы">${settings.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol></section>`,
    CASES: cases,
    CONTACT_DIALOG: `<dialog id="contact-dialog" aria-labelledby="form-title">
      <form method="dialog"><button class="close" aria-label="Закрыть">×</button></form>
      <h2 id="form-title">Расскажите о задаче</h2>
      <a class="telegram-card" href="${escape(telegram)}">Telegram · @${escape(settings.telegram)} ↗</a>
      <p class="contact-divider">Или оставьте заявку на сайте</p>
      <form class="fields" id="request-form">
        <label>Имя<input name="name" autocomplete="name" required></label>
        <label>Контакт<input name="contact" placeholder="Telegram или email" required></label>
        <label>Задача<textarea name="task" rows="4" required></textarea></label>
        <button type="submit" class="button dark">Отправить заявку ↗</button>
        <p class="form-status" role="status"></p>
      </form></dialog>`
  };
  let html = template.replace(/{{([A-Z0-9_]+)}}/g, (_, name) => slots[name] || '');
  // No featured case may expose a hidden project or a misleading accessible name.
  html = html.replace(/aria-label="Кейс «Биосфера Балтики»"/, `aria-label="${escape(projects[0]?.title || 'Работы')}"`);
  if (!projects.length) html = html.replace(/<a class="poster-photo".*?<\/a>/s, '');
  return html;
}
