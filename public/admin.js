const adminFetch = (...args) => window.pagesAdmin ? window.pagesAdmin.fetch(...args) : fetch(...args);
const mediaSource = url => window.pagesAdmin ? window.pagesAdmin.imageUrl(url) : url;
async function login(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById('login-status');
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = 'Проверяем…';
  try {
    const response = await adminFetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    location.assign(window.pagesAdmin?.editorUrl || '/admin');
  } catch (error) { status.textContent = error.message; status.className = 'error'; }
  finally { button.disabled = false; }
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
  const labels = { sections: 'Блоки страницы', projects: 'Проекты', services: 'Услуги', navigation: 'Меню и ссылки', settings: 'Тексты и контакты', appearance: 'Оформление', media: 'Медиатека', requests: 'Заявки' };
  const types = { projects: 'Проекты', services: 'Услуги', about: 'Обо мне', contact: 'Контакты', text: 'Текст', image: 'Текст и изображение', gallery: 'Галерея', cta: 'Блок с кнопкой' };
  const statuses = { draft: 'Черновик', published: window.pagesAdmin ? 'Включён в публикацию' : 'Опубликован', hidden: 'Скрыт' };
  let content;
  let tab = 'sections';
  let selected = 0;
  let busy = false;
  let dirty = false;
  let uploads = 0;
  let editVersion = 0;
  let savedContent;
  let recordControls = [];
  let recordFeedback, publicationFeedback;
  addEventListener('beforeunload', event => { if (dirty || uploads) { event.preventDefault(); event.returnValue = ''; } });

  function message(text, error = false) { notice.textContent = text; notice.classList.toggle('error', error); }
  function syncButtons(notify = true) {
    const publication = window.pagesAdmin?.getPublicationState?.();
    const saveButton = document.getElementById('save');
    saveButton.disabled = busy || uploads > 0 || !dirty;
    saveButton.textContent = busy ? 'Сохраняем…' : 'Сохранить изменения';
    saveButton.setAttribute('aria-busy', String(busy));
    for (const control of recordControls) {
      const previous = savedContent?.[control.collection]?.find(row => row.id === control.record.id);
      const unchanged = previous && JSON.stringify(previous) === JSON.stringify(control.record);
      const publish = publication && control.state === 'published';
      const saved = control.record.status === control.state && unchanged;
      control.node.disabled = busy || uploads > 0 || publication?.sending || (saved && !(publish && publication.needsPublish));
      control.node.setAttribute('aria-busy', String(busy || Boolean(publish && publication.sending)));
      let label = control.label;
      if (publish) {
        label = 'Опубликовать на сайте';
        if (saved && !publication.needsPublish) label = publication.pending ? 'Отправлено в GitHub' : 'Опубликовано';
        if (publication.sending) label = 'Отправляем…';
        if (busy) label = 'Сохраняем…';
      }
      control.node.textContent = label;
    }
    if (recordFeedback) { recordFeedback.textContent = busy ? 'Сохраняем изменения…' : notice.textContent; recordFeedback.classList.toggle('error', notice.classList.contains('error')); }
    if (publicationFeedback) {
      const status = document.getElementById('pages-status');
      publicationFeedback.replaceChildren(...[...status.childNodes].map(node => node.cloneNode(true)));
      publicationFeedback.classList.toggle('error', status.classList.contains('error'));
    }
    if (notify && content && window.pagesAdmin?.onEditorChange) window.pagesAdmin.onEditorChange(content, { dirty, busy, uploads });
  }
  function changed() { dirty = true; editVersion++; message('Есть несохранённые изменения.'); syncButtons(); }
  function uploading(delta) { uploads += delta; syncButtons(); }
  async function api(path, options = {}) {
    const response = await adminFetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': content?.csrf || '', ...options.headers } });
    const data = await response.json();
    if (response.status === 401) { dirty = false; location.assign(window.pagesAdmin?.loginUrl || '/admin'); throw new Error('Войдите в админку.'); }
    if (!response.ok) throw new Error(data.error);
    return data;
  }
  function button(text, action, className = '') {
    const node = element('button', { type: 'button', class: className }, text);
    node.addEventListener('click', action);
    return node;
  }
  function field(parent, labelText, record, key, type = 'text') {
    const label = element('label', {}, labelText);
    const input = type === 'textarea' ? element('textarea', { rows: '4', name: key }) : element('input', { type, name: key });
    input.value = record[key] || '';
    input.addEventListener('input', () => { record[key] = input.value; changed(); });
    label.append(input); parent.append(label); return input;
  }
  function toggle(parent, labelText, checked, action) {
    const label = element('label', { class: 'checkbox-label' });
    const input = element('input', { type: 'checkbox' });
    input.checked = checked;
    input.addEventListener('change', () => { action(input.checked); changed(); });
    label.append(input, document.createTextNode(labelText)); parent.append(label);
  }
  function select(parent, labelText, value, options, action) {
    const label = element('label', {}, labelText);
    const input = element('select', { 'aria-label': labelText });
    for (const [key, text] of Object.entries(options)) input.append(element('option', { value: key }, text));
    input.value = value;
    input.addEventListener('change', () => { action(input.value); changed(); });
    label.append(input); parent.append(label);
  }
  function group(title) {
    const panel = element('section', { class: 'panel fields' });
    panel.append(element('h2', {}, title)); area.append(panel); return panel;
  }
  async function save() {
    if (busy) return false;
    if (uploads) { message('Дождитесь завершения загрузки изображений.', true); return false; }
    busy = true; syncButtons();
    const savingVersion = editVersion;
    try {
      const saved = await api('/api/admin/content', { method: 'PUT', body: JSON.stringify(content) });
      savedContent = structuredClone(saved);
      if (editVersion === savingVersion) {
        content = saved; dirty = false; message(window.pagesAdmin ? 'Изменения сохранены в этом браузере. Для обновления сайта подтвердите публикацию с токеном GitHub.' : 'Изменения сохранены. Опубликованный контент обновлён на сайте.'); render();
      } else {
        content.revision = saved.revision; content.csrf = saved.csrf;
        message('Сохранено. Есть новые несохранённые изменения.');
      }
      return true;
    } catch (error) { message(error.message, true); return false; }
    finally { busy = false; syncButtons(); }
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
  async function pickImage(action) {
    const dialog = document.getElementById('media-picker');
    const items = document.getElementById('media-picker-items');
    items.replaceChildren(element('p', {}, 'Загружаем изображения…')); dialog.showModal();
    try {
      const media = await api('/api/admin/media');
      items.replaceChildren();
      for (const item of media) {
        const node = button(item.name, () => { action(item.url || '/media/' + item.id); changed(); dialog.close(); });
        node.prepend(element('img', { src: mediaSource(item.url || '/media/' + item.id), alt: '' })); items.append(node);
      }
    } catch (error) { items.replaceChildren(element('p', {}, error.message)); }
  }
  function imageField(parent, labelText, record, key, optional = false) {
    const box = element('fieldset', { class: 'image-field' });
    box.append(element('legend', {}, labelText));
    const cover = element('img', { class: 'cover', alt: labelText });
    function update(url) { record[key] = url; cover.hidden = !url; if (url) cover.src = mediaSource(url); }
    update(record[key]);
    const upload = element('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Загрузить ' + labelText.toLowerCase() });
    upload.addEventListener('change', async () => {
      if (!upload.files.length) return;
      upload.disabled = true; uploading(1);
      try { update((await uploadFile(upload.files[0])).url); changed(); }
      catch (error) { message(error.message, true); }
      finally { uploading(-1); upload.disabled = false; upload.value = ''; }
    });
    const actions = element('div', { class: 'header-actions' });
    actions.append(button('Выбрать из медиатеки', () => pickImage(update)));
    if (optional) actions.append(button('Убрать изображение', () => { update(''); changed(); }));
    box.append(cover, upload, actions); parent.append(box);
  }
  function galleryEditor(parent, record, key) {
    const box = element('fieldset', { class: 'image-field' });
    box.append(element('legend', {}, 'Галерея изображений'));
    const upload = element('input', { type: 'file', multiple: '', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Добавить изображения в галерею' });
    upload.addEventListener('change', async () => {
      uploading(1); upload.disabled = true;
      try {
        for (const file of upload.files) { record[key].push({ image: (await uploadFile(file)).url, alt: '' }); changed(); }
      } catch (error) { message(error.message, true); }
      finally { uploading(-1); render(); }
    });
    box.append(upload, button('Добавить из медиатеки', () => pickImage(url => { record[key].push({ image: url, alt: '' }); render(); })));
    record[key].forEach((item, index) => {
      const card = element('div', { class: 'gallery-editor-item fields' });
      card.append(element('img', { class: 'cover', src: mediaSource(item.image), alt: item.alt }));
      field(card, 'Подпись к изображению ' + (index + 1), item, 'alt');
      const actions = element('div', { class: 'header-actions' });
      const up = button('Выше', () => { [record[key][index - 1], record[key][index]] = [item, record[key][index - 1]]; changed(); render(); });
      up.disabled = index === 0;
      actions.append(up, button('Убрать из галереи', () => { record[key].splice(index, 1); changed(); render(); }));
      card.append(actions); box.append(card);
    });
    parent.append(box);
  }
  function projectEditor(panel, record) {
    const form = element('div', { class: 'fields' });
    for (const [key, label, type] of [['title', 'Название'], ['category', 'Подпись на карточке'], ['task', 'Задача', 'textarea'], ['description', 'Результат и описание', 'textarea'], ['technologies', 'Технологии'], ['url', 'Ссылка на проект'], ['linkLabel', 'Текст кнопки проекта']]) field(form, label, record, key, type);
    select(form, 'Оформление плитки', record.cardTheme, { mint: 'Мятная', light: 'Светлая', dark: 'Тёмная', blue: 'Синяя', custom: 'Свои цвета', image: 'Фоновое изображение' }, value => {
      record.cardTheme = value;
      if (value === 'image') { record.cardText = '#ffffff'; record.cardColor = '#17191e'; }
      render();
    });
    if (['custom', 'image'].includes(record.cardTheme)) {
      field(form, 'Цвет фона плитки', record, 'cardColor', 'color');
      field(form, 'Цвет текста плитки', record, 'cardText', 'color');
    }
    if (record.cardTheme === 'image') {
      imageField(form, 'Фон плитки', record, 'backgroundImage', true);
      form.append(element('p', { class: 'hint' }, 'Картинка заполняет плитку целиком. Изображение проекта остаётся внутри кейса.'));
    }
    imageField(form, 'Изображение проекта', record, 'image'); galleryEditor(form, record, 'gallery'); panel.append(form);
  }
  function sectionEditor(panel, record) {
    const form = element('div', { class: 'fields' });
    const availableTypes = Object.fromEntries(Object.entries(types).filter(([type]) => !['projects', 'services', 'about', 'contact'].includes(type) || !content.sections.some(section => section !== record && section.type === type)));
    select(form, 'Тип блока', record.type, availableTypes, value => { record.type = value; render(); });
    field(form, 'Заголовок блока', record, 'title'); field(form, 'Описание блока', record, 'description', 'textarea');
    const menuItem = content.navigation.find(item => item.url === '#' + record.id);
    toggle(form, 'Показывать блок в меню', Boolean(menuItem), enabled => {
      if (enabled) content.navigation.push({ id: crypto.randomUUID(), label: record.title, url: '#' + record.id, status: 'published' });
      else content.navigation = content.navigation.filter(item => item.url !== '#' + record.id);
    });
    if (record.type === 'projects' || record.type === 'services') {
      form.append(button(record.type === 'projects' ? 'Редактировать проекты' : 'Редактировать услуги', () => switchTab(record.type)));
    } else if (record.type === 'about') {
      field(form, 'Текст обо мне', content.settings, 'about', 'textarea');
    } else if (record.type === 'contact') {
      form.append(button('Настроить ссылки и кнопки связи', () => switchTab('settings')));
    } else {
      field(form, 'Текст блока', record, 'body', 'textarea');
      if (record.type === 'image') imageField(form, 'Изображение блока', record, 'image', true);
      if (record.type === 'gallery') galleryEditor(form, record, 'images');
      field(form, 'Ссылка кнопки блока', record, 'url'); field(form, 'Текст кнопки блока', record, 'linkLabel');
    }
    panel.append(form);
  }
  function createRecord() {
    const base = { id: crypto.randomUUID(), status: 'draft' };
    if (tab === 'projects') return { ...base, title: 'Новый проект', category: '', task: '', description: '', technologies: '', url: '', linkLabel: 'Открыть проект', image: '/assets/baltic-logo.png', gallery: [], cardTheme: 'mint', cardColor: '#d8eddf', cardText: '#173d37', backgroundImage: '' };
    if (tab === 'services') return { ...base, title: 'Новая услуга', nav: '', description: '', url: '', linkLabel: '' };
    if (tab === 'navigation') return { ...base, label: 'Новая ссылка', url: '' };
    return { ...base, id: 'block-' + base.id, title: 'Новый блок', type: 'text', description: '', body: '', image: '', images: [], url: '', linkLabel: '' };
  }
  function collectionEditor() {
    const records = content[tab]; selected = Math.max(0, Math.min(selected, records.length - 1));
    const layout = element('div', { class: 'editor-layout' });
    const listPanel = element('section', { class: 'panel' });
    const addLabels = { sections: '+ Добавить блок', projects: '+ Создать проект', services: '+ Добавить услугу', navigation: '+ Добавить ссылку' };
    listPanel.append(button(addLabels[tab], () => { records.push(createRecord()); selected = records.length - 1; changed(); render(); }));
    const list = element('div', { class: 'item-list' });
    records.forEach((record, index) => {
      const entry = button(record.title || record.label, () => { selected = index; render(); });
      entry.setAttribute('aria-pressed', String(index === selected));
      entry.append(element('small', {}, [record.type && types[record.type], statuses[record.status]].filter(Boolean).join(' · '))); list.append(entry);
    });
    listPanel.append(list); layout.append(listPanel);
    if (records.length) {
      const record = records[selected];
      const panel = element('section', { class: 'panel' });
      const heading = element('div', { class: 'editor-title' });
      heading.append(element('h2', {}, record.title || record.label), element('span', { class: 'status-label' }, statuses[record.status])); panel.append(heading);
      if (tab === 'projects') projectEditor(panel, record);
      else if (tab === 'sections') sectionEditor(panel, record);
      else {
        const form = element('div', { class: 'fields' });
        if (tab === 'navigation') { field(form, 'Подпись ссылки', record, 'label'); field(form, 'Адрес ссылки', record, 'url'); }
        else {
          for (const [key, label, type] of [['title', 'Название'], ['nav', 'Короткое название в меню'], ['description', 'Описание', 'textarea'], ['url', 'Ссылка услуги'], ['linkLabel', 'Текст кнопки услуги']]) field(form, label, record, key, type);
        }
        panel.append(form);
      }
      const order = element('div', { class: 'header-actions fields' });
      for (const [delta, label] of [[-1, 'Переместить выше'], [1, 'Переместить ниже']]) {
        const move = button(label, () => { const next = selected + delta; [records[selected], records[next]] = [records[next], records[selected]]; selected = next; changed(); render(); });
        move.disabled = selected + delta < 0 || selected + delta >= records.length; order.append(move);
      }
      const actions = element('div', { class: 'header-actions fields' });
      for (const [state, label] of [['draft', 'Сохранить черновик'], ['published', 'Опубликовать'], ['hidden', 'Скрыть']]) {
        const node = button(label, async () => {
          record.status = state; changed();
          if (await save() && state === 'published' && window.pagesAdmin) await window.pagesAdmin.requestPublication();
        }, state === 'published' ? 'primary' : '');
        recordControls.push({ node, record, collection: tab, state, label }); actions.append(node);
      }
      recordFeedback = element('p', { class: 'hint', role: 'status', 'data-record-status': '' }); actions.append(recordFeedback);
      if (window.pagesAdmin) {
        actions.append(element('p', { class: 'hint' }, '«Опубликовать на сайте» сохраняет материал и открывает подтверждение с токеном GitHub. Публикация включает все подготовленные изменения сайта.'));
        publicationFeedback = element('p', { class: 'hint', role: 'status', 'data-publication-status': '' }); actions.append(publicationFeedback);
      }
      actions.append(button('Удалить', () => {
        if (!confirm('Удалить «' + (record.title || record.label) + '»? Изменение применится после сохранения.')) return;
        records.splice(selected, 1); selected = Math.min(selected, records.length - 1); changed(); render();
      }, 'danger'));
      panel.append(order, actions); layout.append(panel);
    } else listPanel.append(element('p', { class: 'hint' }, 'Добавьте первый материал.'));
    area.append(layout);
  }
  function settingsEditor() {
    const settings = content.settings;
    let panel = group('Название сайта и футер');
    for (const [key, label] of [['siteTitle', 'Заголовок вкладки браузера'], ['brandName', 'Название бренда'], ['footerText', 'Подпись в футере'], ['adminLabel', 'Текст кнопки входа в админку']]) field(panel, label, settings, key);
    panel = group('Первый экран');
    for (const [key, label] of [['intro', 'Подпись над заголовком'], ['subtitle', 'Подзаголовок'], ['headline', 'Первая строка заголовка'], ['headline2', 'Вторая строка заголовка'], ['headline3', 'Акцент в заголовке'], ['heroCtaLabel', 'Текст главной кнопки'], ['heroCtaUrl', 'Ссылка главной кнопки']]) field(panel, label, settings, key);
    panel = group('Ссылки и связь');
    panel.append(element('p', { class: 'hint' }, 'Можно указать @имя Telegram, https://, mailto:, tel: или #раздел.'));
    for (const [key, label] of [['contactUrl', 'Ссылка для связи'], ['contactLabel', 'Кнопка связи в шапке'], ['contactLinkLabel', 'Текст ссылки в окне связи'], ['contactActionLabel', 'Кнопка в блоке контактов'], ['contactDialogTitle', 'Заголовок окна связи']]) field(panel, label, settings, key);
    select(panel, 'Действие кнопки в контактах', settings.contactMode, { dialog: 'Открыть окно связи', link: 'Перейти по ссылке' }, value => { settings.contactMode = value; });
    toggle(panel, 'Показывать форму заявки', settings.showRequestForm, value => { settings.showRequestForm = value; });
    for (const [key, label] of [['requestIntro', 'Текст перед формой'], ['requestNameLabel', 'Подпись поля имени'], ['requestContactLabel', 'Подпись поля контакта'], ['requestTaskLabel', 'Подпись поля задачи'], ['requestSubmitLabel', 'Текст кнопки отправки']]) field(panel, label, settings, key);
    panel = group('Обо мне и этапы работы');
    field(panel, 'Обо мне', settings, 'about', 'textarea');
    const steps = field(panel, 'Этапы работы · каждый с новой строки', { steps: settings.steps.join('\n') }, 'steps', 'textarea');
    steps.addEventListener('input', () => { settings.steps = steps.value.split('\n').map(step => step.trim()).filter(Boolean); });
  }
  function appearanceEditor() {
    const panel = group('Оформление сайта');
    imageField(panel, 'Логотип', content.settings, 'logo', true);
    field(panel, 'Основной цвет', content.settings, 'accent', 'color');
    field(panel, 'Цвет фона', content.settings, 'paper', 'color');
    toggle(panel, 'Показывать декоративные стикеры', content.settings.showStickers, value => { content.settings.showStickers = value; });
  }
  function usedImage(url) {
    return content.settings.logo === url || content.projects.some(row => row.image === url || row.backgroundImage === url || row.gallery.some(item => item.image === url)) || content.sections.some(row => row.image === url || row.images.some(item => item.image === url));
  }
  async function mediaEditor() {
    const panel = group('Медиатека');
    const uploadLabel = element('label', {}, 'Загрузить изображения');
    const upload = element('input', { type: 'file', multiple: '', accept: 'image/png,image/jpeg,image/webp' }); uploadLabel.append(upload); panel.append(uploadLabel);
    upload.addEventListener('change', async () => {
      uploading(1); upload.disabled = true;
      try { for (const file of upload.files) await uploadFile(file); message('Изображения загружены.'); }
      catch (error) { message(error.message, true); }
      finally { uploading(-1); render(); }
    });
    const media = await api('/api/admin/media');
    if (tab !== 'media') return;
    const gallery = element('div', { class: 'media-grid' });
    if (!media.length) gallery.append(element('p', { class: 'hint' }, 'Пока нет загруженных изображений. Добавьте их здесь или в редакторе блока.'));
    for (const item of media) {
      const url = item.url || '/media/' + item.id;
      const card = element('article', { class: 'media-card' }); card.append(element('img', { src: mediaSource(url), alt: item.name }), element('p', {}, item.name));
      if (!item.url) card.append(button('Удалить', async () => {
        if (usedImage(url)) { message('Изображение используется в текущем контенте. Сначала уберите его из блоков или проектов.', true); return; }
        if (!confirm('Удалить изображение из медиатеки?')) return;
        try { await api('/api/admin/media/' + item.id, { method: 'DELETE' }); render(); }
        catch (error) { message(error.message, true); }
      }, 'danger')); gallery.append(card);
    }
    panel.append(gallery);
  }
  async function requestsEditor() {
    const panel = element('section', { class: 'requests' }); area.append(panel);
    panel.append(button('Обновить заявки', render));
    const records = await api('/api/admin/requests'); if (tab !== 'requests') return;
    if (!records.length) panel.append(element('p', {}, window.pagesAdmin ? 'На GitHub Pages обращения поступают по вашим контактным ссылкам. Встроенный сбор заявок доступен в серверной версии.' : 'Заявок пока нет.'));
    for (const record of records) {
      const card = element('article', { class: 'panel request-card' });
      card.append(element('span', { class: 'hint' }, new Date(record.created).toLocaleString('ru-RU')), element('h2', {}, record.name), element('p', {}, record.contact), element('p', {}, record.task)); panel.append(card);
    }
  }
  function switchTab(next) { tab = next; selected = 0; render(); }
  function render() {
    recordControls = []; recordFeedback = publicationFeedback = null; area.replaceChildren(); document.getElementById('section-title').textContent = labels[tab];
    document.querySelectorAll('[data-tab]').forEach(button => {
      if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    if (['sections', 'projects', 'services', 'navigation'].includes(tab)) collectionEditor();
    else if (tab === 'settings') settingsEditor();
    else if (tab === 'appearance') appearanceEditor();
    else if (tab === 'media') mediaEditor().catch(error => message(error.message, true));
    else requestsEditor().catch(error => message(error.message, true));
    syncButtons();
  }
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  document.getElementById('save').addEventListener('click', save);
  document.getElementById('logout').addEventListener('click', async () => {
    if (uploads) { message('Дождитесь завершения загрузки изображений.', true); return; }
    if (dirty && !confirm('Выйти без сохранения изменений?')) return;
    try { await api('/api/logout', { method: 'POST' }); dirty = false; location.assign(window.pagesAdmin?.loginUrl || '/admin'); }
    catch (error) { message(error.message, true); }
  });
  document.getElementById('preview').addEventListener('click', async () => {
    if (uploads) { message('Дождитесь завершения загрузки изображений.', true); return; }
    try {
      const data = await api('/api/admin/preview', { method: 'POST', body: JSON.stringify(content) });
      const dialog = document.getElementById('preview-dialog'); dialog.querySelector('iframe').srcdoc = data.html; dialog.showModal();
    } catch (error) { message(error.message, true); }
  });
  if (window.pagesAdmin) {
    window.pagesAdmin.onPublicationChange = () => syncButtons(false);
    window.pagesAdmin.saveBeforeExport = async () => {
      if (dirty) await save();
      if (busy || dirty || uploads) throw new Error('Сначала завершите сохранение изменений.');
    };
  }
  try { content = await api('/api/admin/content'); savedContent = structuredClone(content); message('Контент загружен.'); render(); }
  catch (error) { message(error.message, true); }
}
