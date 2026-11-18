function text(value) {
  if (typeof value !== 'string') throw new Error('Проверьте текстовые поля.');
  return value.trim();
}

function image(value) {
  const path = text(value);
  if (!/^\/(assets\/[a-zA-Z0-9._-]+|media\/[a-f0-9-]+)$/.test(path)) throw new Error('Выберите изображение из медиатеки.');
  return path;
}

export function validateContent(body) {
  const settings = {};
  for (const key of ['intro', 'subtitle', 'headline', 'headline2', 'headline3', 'telegram', 'about']) {
    settings[key] = text(body.settings?.[key]);
  }
  if (!/^[A-Za-z0-9_]+$/.test(settings.telegram)) throw new Error('Укажите имя Telegram без @ и ссылки.');
  if (!Array.isArray(body.settings.steps)) throw new Error('Проверьте этапы работы.');
  settings.steps = body.settings.steps.map(text);
  function collection(rows, keys) {
    if (!Array.isArray(rows)) throw new Error('Проверьте список материалов.');
    const ids = new Set();
    return rows.map(row => {
      const record = { id: text(row.id), status: text(row.status) };
      if (!/^[a-zA-Z0-9-]+$/.test(record.id) || ids.has(record.id)) throw new Error('Некорректный идентификатор.');
      ids.add(record.id);
      if (!['draft', 'published', 'hidden'].includes(record.status)) throw new Error('Некорректный статус.');
      for (const key of keys) record[key] = text(row[key]);
      if (!record.title) throw new Error('Укажите название.');
      if ('image' in row) record.image = image(row.image);
      if ('url' in row) {
        record.url = text(row.url);
        if (record.url && !/^https?:\/\//.test(record.url)) throw new Error('Ссылка проекта должна начинаться с https:// или http://.');
        if (record.url) new URL(record.url);
      }
      return record;
    });
  }
  return {
    settings,
    projects: collection(body.projects, ['title', 'category', 'description', 'task', 'technologies', 'image', 'url']),
    services: collection(body.services, ['title', 'nav', 'description'])
  };
}
