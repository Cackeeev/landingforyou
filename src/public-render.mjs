import { normalizeContent } from './content.mjs';

export function escape(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
const paragraphs = value => String(value).split(/\n\s*\n/).filter(Boolean).map(part => `<p>${escape(part).replaceAll('\n', '<br>')}</p>`).join('');
const gallery = images => images.length ? `<div class="content-gallery">${images.map(item => `<figure><img src="${escape(item.image)}" alt="${escape(item.alt)}" loading="lazy">${item.alt ? `<figcaption>${escape(item.alt)}</figcaption>` : ''}</figure>`).join('')}</div>` : '';

export function renderContent(rawContent, template) {
  const content = normalizeContent(rawContent);
  const { settings } = content;
  const sections = content.sections.filter(section => section.status === 'published');
  const projects = content.projects.filter(project => project.status === 'published');
  const services = content.services.filter(service => service.status === 'published');
  const workSection = sections.find(section => section.type === 'projects');
  const servicesSection = sections.find(section => section.type === 'services');
  const anchors = new Set(['top', ...sections.map(section => section.id), ...(servicesSection ? services.map(service => 'service-' + service.id) : [])]);
  const validLink = url => url && (!url.startsWith('#') || anchors.has(url.slice(1)));
  const cta = (url, label, className = 'button') => validLink(url) && label ? `<a class="${className}" href="${escape(url)}">${escape(label)} <span aria-hidden="true">↗</span></a>` : '';
  const work = projects.map(project => `
    <button type="button" class="project-preview project-preview--${escape(project.cardTheme)}" data-project="${escape(project.id)}" data-open="case-${escape(project.id)}">
      ${project.cardTheme === 'image' && project.backgroundImage ? `<img class="project-background" src="${escape(project.backgroundImage)}" alt="" aria-hidden="true" loading="lazy">` : ''}
      <img class="project-cover" src="${escape(project.image)}" alt="Логотип или изображение проекта «${escape(project.title)}»" loading="lazy">
      <span class="project-label"><span><small>${escape(project.category)}</small><span class="project-name">${escape(project.title)}</span></span><span class="circle-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19 19 5M5 5h14v14"/></svg></span></span>
    </button>`).join('');
  const cases = !workSection ? '' : projects.map(project => `
    <dialog id="case-${escape(project.id)}" aria-labelledby="title-${escape(project.id)}">
      <form method="dialog"><button class="close" aria-label="Закрыть">×</button></form>
      <h2 id="title-${escape(project.id)}">${escape(project.title)}</h2>
      <img src="${escape(project.image)}" alt="${escape(project.title)}">
      <h3>Задача</h3>${paragraphs(project.task)}
      <h3>Результат</h3>${paragraphs(project.description)}
      ${project.technologies ? `<p class="case-tech">${escape(project.technologies)}</p>` : ''}
      ${gallery(project.gallery)}
      ${cta(project.url, project.linkLabel)}
    </dialog>`).join('');
  function sectionHtml(section) {
    const id = escape(section.id);
    const heading = `<h2 class="section-heading" id="section-${id}-title">${escape(section.title)}</h2>`;
    const intro = section.description ? `<div class="section-description">${paragraphs(section.description)}</div>` : '';
    let body;
    let className;
    if (section.type === 'projects') {
      className = 'work';
      body = `<div class="work-heading">${heading}</div>${intro}${work}`;
    } else if (section.type === 'services') {
      className = 'services';
      body = `${heading}${intro}${services.map(service => `<details class="service" id="service-${escape(service.id)}"><summary>${escape(service.title)}</summary>${paragraphs(service.description)}${cta(service.url, service.linkLabel)}</details>`).join('')}`;
    } else if (section.type === 'about') {
      className = 'process';
      body = `<div>${heading}${intro}${paragraphs(settings.about)}</div><ol aria-label="Этапы работы">${settings.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol>`;
    } else if (section.type === 'contact') {
      className = 'contact';
      body = `${heading}${intro}${settings.contactMode === 'link' ? cta(settings.contactUrl, settings.contactActionLabel, 'button light') : `<button type="button" class="button light" data-open="contact-dialog">${escape(settings.contactActionLabel)} <span aria-hidden="true">↗</span></button>`}`;
    } else {
      className = 'content-block' + (section.type === 'cta' ? ' content-block-cta' : '');
      body = `${heading}${intro}<div class="block-copy">${paragraphs(section.body)}</div>
        ${section.type === 'image' && section.image ? `<img class="block-image" src="${escape(section.image)}" alt="${escape(section.title)}" loading="lazy">` : ''}
        ${section.type === 'gallery' ? gallery(section.images) : ''}${cta(section.url, section.linkLabel)}`;
    }
    return `<section class="${className} pad" id="${id}" aria-labelledby="section-${id}-title">${body}</section>`;
  }
  const slots = {
    SITE_TITLE: escape(settings.siteTitle), ACCENT: escape(settings.accent),
    POSTER_CLASS: settings.showStickers ? '' : 'no-stickers',
    WORDMARK: `<a class="wordmark${settings.logo === '/assets/wordmark.webp' ? '' : ' custom-logo'}" href="#top" aria-label="${escape(settings.brandName)}">${settings.logo ? `<img src="${escape(settings.logo)}" alt="" width="1602" height="982">` : escape(settings.brandName)}</a>`,
    NAVIGATION: content.navigation.filter(item => item.status === 'published' && validLink(item.url)).map(item => `<a href="${escape(item.url)}">${escape(item.label)}</a>`).join(''),
    CONTACT_BUTTON: validLink(settings.contactUrl) ? `<a class="button contact-link" href="${escape(settings.contactUrl)}"><span class="contact-dot" aria-hidden="true"></span> ${escape(settings.contactLabel)}</a>` : '',
    INTRO: escape(settings.intro), SUBTITLE: escape(settings.subtitle),
    HEADLINE: escape(settings.headline), HEADLINE2: escape(settings.headline2), HEADLINE3: escape(settings.headline3),
    HERO_CTA: cta(settings.heroCtaUrl, settings.heroCtaLabel, 'poster-cta'),
    WORK_URL: workSection ? '#' + escape(workSection.id) : '#top',
    WORK_SCROLL_LABEL: workSection ? escape('Прокрутить: ' + workSection.title) : '',
    SECTIONS: sections.map(sectionHtml).join('\n'),
    SERVICE_NAV: !servicesSection ? '' : `<nav class="poster-footer" aria-label="Направления работы">${services.map(service => `<a href="#service-${escape(service.id)}">${escape(service.nav || service.title)}</a>`).join('')}</nav>`,
    FOOTER_TEXT: escape(settings.footerText), ADMIN_LABEL: escape(settings.adminLabel),
    CASES: cases,
    CONTACT_DIALOG: `<dialog id="contact-dialog" aria-labelledby="form-title">
      <form method="dialog"><button class="close" aria-label="Закрыть">×</button></form>
      <h2 id="form-title">${escape(settings.contactDialogTitle)}</h2>
      ${cta(settings.contactUrl, settings.contactLinkLabel, 'telegram-card')}
      ${!settings.showRequestForm ? '' : `<p class="contact-divider">${escape(settings.requestIntro)}</p>
      <form class="fields" id="request-form">
        <label>${escape(settings.requestNameLabel)}<input name="name" autocomplete="name" required></label>
        <label>${escape(settings.requestContactLabel)}<input name="contact" required></label>
        <label>${escape(settings.requestTaskLabel)}<textarea name="task" rows="4" required></textarea></label>
        <button type="submit" class="button dark">${escape(settings.requestSubmitLabel)}</button>
        <p class="form-status" role="status"></p>
      </form>`}</dialog>`
  };
  return template.replace(/{{WORK_STICKER_START}}([\s\S]*?){{WORK_STICKER_END}}/, (_, sticker) => workSection ? sticker : '')
    .replace(/{{([A-Z0-9_]+)}}/g, (_, name) => slots[name] || '');
}
