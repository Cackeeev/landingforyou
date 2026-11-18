async function login(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById('login-status');
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = 'Проверяем…';
  try {
    const response = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    location.assign('/admin');
  } catch (error) {
    status.textContent = error.message;
    status.className = 'error';
  } finally {
    button.disabled = false;
  }
}

const loginForm = document.getElementById('login-form');
if (loginForm) loginForm.addEventListener('submit', login);
else initializeAdmin();

function element(tag, attributes = {}, text = '') {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  return node;
}

async function initializeAdmin() {
  const area = document.getElementById('editor-area');
  const notice = document.getElementById('save-status');
  const labels = { projects: 'Проекты', services: 'Услуги', settings: 'Тексты и контакты', media: 'Медиатека', requests: 'Заявки' };
  const statuses = { draft: 'Черновик', published: 'Опубликован', hidden: 'Скрыт' };
  let content;
  let tab = 'projects';
  let selected = 0;
  let busy = false;

  function message(text, error = false) {
    notice.textContent = text;
    notice.classList.toggle('error', error);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': content?.csrf || '', ...options.headers }
    });
    const data = await response.json();
    if (response.status === 401) { location.assign('/admin'); throw new Error('Войдите в админку.'); }
    if (!response.ok) throw new Error(data.error);
    return data;
  }

  function changed() { message('Есть несохранённые изменения.'); }

  function field(parent, labelText, record, key, type = 'text') {
    const label = element('label', {}, labelText);
    const input = type === 'textarea' ? element('textarea', { rows: '4', name: key }) : element('input', { type, name: key });
    input.value = record[key] || '';
    input.addEventListener('input', () => { record[key] = input.value; changed(); });
    label.append(input);
    parent.append(label);
    return input;
  }

  async function save() {
    if (busy) return;
    busy = true;
    document.getElementById('save').disabled = true;
    try {
      content = await api('/api/admin/content', { method: 'PUT', body: JSON.stringify(content) });
      message('Изменения сохранены. Опубликованный контент обновлён на сайте.');
      render();
    } catch (error) { message(error.message, true); }
    finally { busy = false; document.getElementById('save').disabled = false; }
  }

  function button(text, action, className) {
    const node = element('button', { type: 'button', ...(className ? { class: className } : {}) }, text);
    node.addEventListener('click', action);
    return node;
  }

  function projectEditor(panel, record) {
    const form = element('form', { class: 'fields' });
    form.addEventListener('submit', event => event.preventDefault());
    field(form, 'Название', record, 'title');
    field(form, 'Подпись на карточке', record, 'category');
    field(form, 'Задача', record, 'task', 'textarea');
    field(form, 'Результат и описание', record, 'description', 'textarea');
    field(form, 'Технологии', record, 'technologies');
    field(form, 'Ссылка на проект', record, 'url', 'url');
    const cover = element('img', { class: 'cover', src: record.image, alt: 'Изображение проекта' });
    const imageActions = element('div', { class: 'header-actions' });
    const upload = element('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Загрузить изображение проекта' });
    upload.addEventListener('change', async () => {
      try {
        upload.disabled = true;
        const media = await uploadFile(upload.files[0]);
        record.image = media.url;
        cover.src = media.url;
        changed();
      } catch (error) { message(error.message, true); }
      finally { upload.disabled = false; }
    });
    imageActions.append(button('Выбрать из медиатеки', () => switchTab('media')));
    form.append(element('p', { class: 'hint' }, 'Изображение проекта · PNG, JPEG, WebP'), cover, upload, imageActions);
    panel.append(form);
  }

  function collectionEditor() {
    const records = content[tab];
    const layout = element('div', { class: 'editor-layout' });
    const listPanel = element('section', { class: 'panel' });
    const add = button(tab === 'projects' ? '+ Создать проект' : '+ Добавить услугу', () => {
      const record = tab === 'projects'
        ? { id: crypto.randomUUID(), title: 'Новый проект', category: '', task: '', description: '', technologies: '', url: '', image: '/assets/baltic-logo.png', status: 'draft' }
        : { id: crypto.randomUUID(), title: 'Новая услуга', nav: '', description: '', status: 'draft' };
      records.push(record);
      selected = records.length - 1;
      changed();
      render();
    });
    const list = element('div', { class: 'item-list' });
    records.forEach((record, index) => {
      const entry = button(record.title, () => { selected = index; render(); });
      entry.setAttribute('aria-pressed', String(index === selected));
      entry.append(element('small', {}, statuses[record.status]));
      list.append(entry);
    });
    listPanel.append(add, list);
    layout.append(listPanel);
    if (records.length) {
      selected = Math.min(selected, records.length - 1);
      const record = records[selected];
      const panel = element('section', { class: 'panel' });
      const heading = element('div', { class: 'editor-title' });
      heading.append(element('h2', {}, record.title), element('span', { class: 'status-label' }, statuses[record.status]));
      panel.append(heading);
      if (tab === 'projects') projectEditor(panel, record);
      else {
        const form = element('div', { class: 'fields' });
        field(form, 'Название', record, 'title');
        field(form, 'Короткое название в меню', record, 'nav');
        field(form, 'Описание', record, 'description', 'textarea');
        panel.append(form);
      }
      const actions = element('div', { class: 'header-actions fields' });
      const saveActions = element('div', { class: 'header-actions' });
      for (const [state, label] of [['draft', 'Сохранить черновик'], ['published', 'Опубликовать'], ['hidden', 'Скрыть']]) {
        saveActions.append(button(label, () => { record.status = state; save(); }, state === 'published' ? 'primary' : ''));
      }
      actions.append(saveActions, button('Удалить', () => {
        if (!confirm('Удалить «' + record.title + '»? Изменение применится после сохранения.')) return;
        records.splice(selected, 1);
        selected = 0;
        changed();
        render();
      }, 'danger'));
      panel.append(actions);
      layout.append(panel);
    }
    area.append(layout);
  }

  function settingsEditor() {
    const panel = element('section', { class: 'panel fields' });
    const settings = content.settings;
    for (const [key, label] of [
      ['intro','Подпись над заголовком'], ['subtitle','Подзаголовок'], ['headline','Первая строка заголовка'],
      ['headline2','Вторая строка заголовка'], ['headline3','Акцент в заголовке'], ['telegram','Telegram без @'],
      ['about','Обо мне']
    ]) field(panel, label, settings, key, key === 'about' ? 'textarea' : 'text');
    const label = element('label', {}, 'Этапы работы · каждый с новой строки');
    const input = element('textarea', { rows: '6', name: 'steps' });
    input.value = settings.steps.join('\n');
    input.addEventListener('input', () => {
      settings.steps = input.value.split('\n').filter(step => step.trim());
      changed();
    });
    label.append(input);
    panel.append(label);
    area.append(panel);
  }

  async function uploadFile(file) {
    if (!file) throw new Error('Выберите изображение.');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
      reader.readAsDataURL(file);
    });
    return api('/api/admin/media', { method: 'POST', body: JSON.stringify({ name: file.name, data }) });
  }

  async function mediaEditor() {
    const panel = element('section', { class: 'panel' });
    const uploadLabel = element('label', {}, 'Загрузить изображение');
    const upload = element('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
    uploadLabel.append(upload);
    panel.append(uploadLabel);
    area.append(panel);
    upload.addEventListener('change', async () => {
      try {
        upload.disabled = true;
        await uploadFile(upload.files[0]);
        message('Изображение загружено.');
        render();
      } catch (error) { message(error.message, true); upload.disabled = false; }
    });
    const media = await api('/api/admin/media');
    if (tab !== 'media') return;
    const gallery = element('div', { class: 'media-grid' });
    for (const item of [{ id: 'baltic-logo', name: 'Биосфера Балтики · оригинал', url: '/assets/baltic-logo.png' }, ...media]) {
      const url = item.url || '/media/' + item.id;
      const card = element('article', { class: 'media-card' });
      card.append(element('img', { src: url, alt: item.name }), element('p', {}, item.name));
      card.append(button('В выбранный проект', () => {
        const project = content.projects[Math.min(selected, content.projects.length - 1)];
        if (!project) { message('Сначала создайте проект.', true); return; }
        project.image = url;
        changed();
        switchTab('projects', false);
      }));
      if (!item.url) card.append(button('Удалить', async () => {
        if (!confirm('Удалить изображение из медиатеки?')) return;
        try {
          await api('/api/admin/media/' + item.id, { method: 'DELETE' });
          render();
        } catch (error) { message(error.message, true); }
      }, 'danger'));
      gallery.append(card);
    }
    panel.append(gallery);
  }

  async function requestsEditor() {
    const panel = element('section', { class: 'requests' });
    area.append(panel);
    panel.append(button('Обновить заявки', () => render()));
    const records = await api('/api/admin/requests');
    if (tab !== 'requests') return;
    if (!records.length) panel.append(element('p', {}, 'Заявок пока нет.'));
    records.forEach(record => {
      const card = element('article', { class: 'panel request-card' });
      card.append(element('span', { class: 'hint' }, new Date(record.created).toLocaleString('ru-RU')));
      card.append(element('h2', {}, record.name), element('p', {}, record.contact), element('p', {}, record.task));
      panel.append(card);
    });
  }

  function switchTab(next, reset = true) {
    if (reset && (next === 'projects' || next === 'services')) selected = 0;
    tab = next;
    render();
  }

  function render() {
    area.replaceChildren();
    document.getElementById('section-title').textContent = labels[tab];
    document.querySelectorAll('[data-tab]').forEach(button => {
      if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (tab === 'projects' || tab === 'services') collectionEditor();
    else if (tab === 'settings') settingsEditor();
    else if (tab === 'media') mediaEditor().catch(error => message(error.message, true));
    else requestsEditor().catch(error => message(error.message, true));
  }

  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  document.getElementById('save').addEventListener('click', save);
  document.getElementById('logout').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); location.assign('/admin'); }
    catch (error) { message(error.message, true); }
  });
  document.getElementById('preview').addEventListener('click', async () => {
    try {
      const data = await api('/api/admin/preview', { method: 'POST', body: JSON.stringify(content) });
      const dialog = document.getElementById('preview-dialog');
      dialog.querySelector('iframe').srcdoc = data.html;
      dialog.showModal();
    } catch (error) { message(error.message, true); }
  });

  try {
    content = await api('/api/admin/content');
    message('Контент загружен.');
    render();
  } catch (error) { message(error.message, true); }
}
