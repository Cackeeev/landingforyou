import { normalizeContent, defaultSettings, projectThemes } from './content.mjs';

function text(value) {
  if (typeof value !== 'string') throw new Error('Проверьте текстовые поля.');
  return value.trim();
}

function image(value, optional = false) {
  const path = text(value);
  if (optional && !path) return '';
  if (!/^\/(assets\/[a-zA-Z0-9._-]+|media\/[a-f0-9-]+)$/.test(path)) throw new Error('Выберите изображение из медиатеки.');
  return path;
}

export function link(value) {
  let address = text(value);
  if (!address) return '';
  if (/^@[A-Za-z0-9_]+$/.test(address)) address = 'https://t.me/' + address.slice(1);
  if (/^t\.me\//.test(address)) address = 'https://' + address;
  if (/^#[A-Za-z0-9-]+$/.test(address)) return address;
  let url;
  try { url = new URL(address); } catch { throw new Error('Укажите полную ссылку, например https://example.com, или @имя Telegram.'); }
  if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Разрешены ссылки https://, http://, mailto:, tel: и якоря #раздел.');
  }
  return url.href;
}

function records(rows) {
  if (!Array.isArray(rows)) throw new Error('Проверьте список материалов.');
  const ids = new Set();
  return rows.map(row => {
    if (!row || typeof row !== 'object') throw new Error('Проверьте материал.');
    const id = text(row.id);
    if (!/^[a-zA-Z0-9-]+$/.test(id) || ids.has(id)) throw new Error('Некорректный идентификатор.');
    ids.add(id);
    if (!['draft', 'published', 'hidden'].includes(row.status)) throw new Error('Некорректный статус.');
    return { ...row, id };
  });
}

function gallery(rows) {
  if (!Array.isArray(rows)) throw new Error('Проверьте галерею изображений.');
  return rows.map(row => ({ image: image(row.image), alt: text(row.alt) }));
}

export function validateContent(body) {
  if (!body || !body.settings || !Array.isArray(body.projects) || !Array.isArray(body.services)) throw new Error('Проверьте структуру контента.');
  const content = normalizeContent(body);
  const settings = {};
  for (const key of ['intro', 'subtitle', 'headline', 'headline2', 'headline3', 'telegram', 'about',
    ...Object.keys(defaultSettings).filter(key => !['showStickers', 'showRequestForm'].includes(key))]) {
    settings[key] = text(content.settings[key]);
  }
  if (!/^[A-Za-z0-9_]+$/.test(settings.telegram)) throw new Error('Укажите имя Telegram без @ и ссылки.');
  if (!Array.isArray(content.settings.steps)) throw new Error('Проверьте этапы работы.');
  settings.steps = content.settings.steps.map(text);
  settings.contactUrl = link(content.settings.contactUrl);
  settings.heroCtaUrl = link(settings.heroCtaUrl);
  settings.logo = image(settings.logo, true);
  for (const key of ['accent', 'paper']) if (!/^#[a-fA-F0-9]{6}$/.test(settings[key])) throw new Error('Укажите цвет в формате #123ABC.');
  for (const key of ['showStickers', 'showRequestForm']) {
    if (typeof content.settings[key] !== 'boolean') throw new Error('Проверьте переключатели оформления.');
    settings[key] = content.settings[key];
  }
  if (!['dialog', 'link'].includes(settings.contactMode)) throw new Error('Выберите действие кнопки связи.');
  const projects = records(content.projects).map(row => {
    const record = { id: row.id, status: row.status };
    for (const key of ['title', 'category', 'description', 'task', 'technologies', 'linkLabel']) record[key] = text(row[key]);
    if (!record.title) throw new Error('Укажите название проекта.');
    record.image = image(row.image);
    record.url = link(row.url);
    record.gallery = gallery(row.gallery);
    record.cardTheme = text(row.cardTheme);
    if (!Object.hasOwn(projectThemes, record.cardTheme)) throw new Error('Выберите оформление плитки.');
    for (const key of ['cardColor', 'cardText']) {
      record[key] = text(row[key]);
      if (!/^#[a-fA-F0-9]{6}$/.test(record[key])) throw new Error('Укажите цвет плитки в формате #123ABC.');
    }
    record.backgroundImage = image(row.backgroundImage, true);
    if (record.cardTheme === 'image' && record.status === 'published' && !record.backgroundImage) throw new Error('Добавьте фоновое изображение для плитки.');
    return record;
  });
  const services = records(content.services).map(row => {
    const record = { id: row.id, status: row.status, url: link(row.url) };
    for (const key of ['title', 'nav', 'description', 'linkLabel']) record[key] = text(row[key]);
    if (!record.title) throw new Error('Укажите название услуги.');
    return record;
  });
  const builtinTypes = new Set();
  const sections = records(content.sections).map(row => {
    const record = { id: row.id, status: row.status, type: text(row.type) };
    if (!['projects', 'services', 'about', 'contact', 'text', 'image', 'gallery', 'cta'].includes(record.type)) throw new Error('Выберите тип блока.');
    if (['top', 'hero-title', 'request-form', 'contact-dialog', 'form-title'].includes(record.id) || /^(case-|title-|service-|section-)/.test(record.id)) throw new Error('Идентификатор блока занят.');
    if (['projects', 'services', 'about', 'contact'].includes(record.type)) {
      if (builtinTypes.has(record.type)) throw new Error('Этот системный блок уже есть на странице.');
      builtinTypes.add(record.type);
    }
    for (const key of ['title', 'description', 'body', 'linkLabel']) record[key] = text(row[key]);
    if (!record.title) throw new Error('Укажите заголовок блока.');
    record.url = link(row.url);
    record.image = image(row.image, true);
    record.images = gallery(row.images);
    return record;
  });
  const navigation = records(content.navigation).map(row => {
    const record = { id: row.id, status: row.status, label: text(row.label), url: link(row.url) };
    if (!record.label || !record.url) throw new Error('Укажите подпись и адрес пункта меню.');
    return record;
  });
  return { settings, projects, services, sections, navigation };
}
