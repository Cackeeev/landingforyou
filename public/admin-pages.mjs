import { normalizeContent, imagePaths, themeCss } from './shared/content.mjs';
import { validateContent } from './shared/validate.mjs';
import { renderContent } from './shared/public-render.mjs';
import { encode, decode, passwordKey, importKey, exportKey, encrypt, decrypt } from './admin-crypto.mjs';
import { zip } from './admin-zip.mjs';

const base = new URL('../', import.meta.url);
const loginUrl = new URL('./', import.meta.url).href;
const editorUrl = new URL('editor.html', import.meta.url).href;
const sessionName = 'pages-editor:' + base.pathname;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const editorPage = location.pathname.endsWith('/editor.html');
let manifest, seed, stateKey, stateSalt, database, template;
let queue = Promise.resolve();
const mediaUrls = new Map();

function record() {
  return new Promise((resolve, reject) => {
    const request = database.transaction('documents').objectStore('documents').get('draft');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
function write(expected, value) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('documents', 'readwrite');
    const store = transaction.objectStore('documents');
    let conflict = false;
    const request = store.get('draft');
    request.onsuccess = () => {
      if ((request.result?.version || 0) !== expected) { conflict = true; transaction.abort(); return; }
      store.put(value, 'draft');
    };
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(Object.assign(new Error('Черновик изменился в другой вкладке.'), { conflict }));
    transaction.onerror = () => reject(new Error('Не удалось сохранить черновик. Проверьте свободное место в браузере.'));
  });
}
async function state() {
  if (!stateKey) fail(401, 'Войдите в редактор.');
  const stored = await record();
  if (!stored) return { stored, value: { content: { ...normalizeContent(seed.content), revision: 1 }, media: [], baselineSeedSha: manifest.seedSha } };
  if (stored.salt !== stateSalt) fail(401, 'Откройте редактор заново.');
  const value = await decrypt(stored, stateKey);
  value.media.forEach(mediaUrl);
  return { stored, value };
}
function mutate(action) {
  const work = queue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await state();
      const result = action(current.value);
      const version = (current.stored?.version || 0) + 1;
      const encrypted = await encrypt(current.value, stateKey);
      try { await write(version - 1, { ...encrypted, salt: stateSalt, version }); return result; }
      catch (error) { if (!error.conflict) throw error; }
    }
    fail(409, 'Черновик изменился в другой вкладке. Обновите страницу.');
  });
  queue = work.catch(() => {}); return work;
}
async function login(body) {
  if (body.username !== manifest.username) fail(401, 'Неверный логин или пароль.');
  let seedKey;
  try { seedKey = await passwordKey(body.password, manifest.salt, manifest.iterations); await decrypt(manifest, seedKey); seed = { content: manifest.content }; }
  catch { fail(401, 'Неверный логин или пароль.'); }
  const stored = await record();
  stateSalt = stored?.salt || manifest.salt;
  stateKey = stateSalt === manifest.salt ? seedKey : await passwordKey(body.password, stateSalt, manifest.iterations);
  if (stored) {
    try { await decrypt(stored, stateKey); } catch { fail(401, 'Не удалось открыть локальный черновик этим паролем.'); }
  }
  sessionStorage.setItem(sessionName, JSON.stringify({ seedKey: await exportKey(seedKey), stateKey: await exportKey(stateKey), stateSalt, salt: manifest.salt }));
  return { ok: true };
}
function mediaType(bytes) {
  if ([137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const text = new TextDecoder();
  if (text.decode(bytes.subarray(0,4)) === 'RIFF' && text.decode(bytes.subarray(8,12)) === 'WEBP') return 'image/webp';
  fail(400, 'Используйте PNG, JPEG или WebP.');
}
function mediaUrl(item) {
  if (!mediaUrls.has(item.id)) mediaUrls.set(item.id, URL.createObjectURL(new Blob([decode(item.data)], { type: item.mime })));
  return mediaUrls.get(item.id);
}
async function preview(content, media) {
  content.projects.forEach(row => { row.status = 'published'; }); content.services.forEach(row => { row.status = 'published'; });
  content.sections.forEach(row => { row.status = 'published'; }); content.navigation.forEach(row => { row.status = 'published'; });
  let html = renderContent(content, template).replace('href="/theme.css"', 'href="data:text/css,' + encodeURIComponent(themeCss(content.settings)) + '"');
  html = html.replace(/<p class="contact-divider">.*?<\/form>/s, '');
  html = html.replace(/(href|src)="\/media\/([a-f0-9-]+)"/g, (match, attribute, id) => {
    const item = media.find(item => item.id === id); return item ? `${attribute}="${mediaUrl(item)}"` : match;
  });
  return html.replace(/(href|src)="\/(?!\/|media\/)/g, (_, attribute) => attribute + '="' + base.pathname);
}
async function api(path, options = {}) {
  try {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : {};
    if (path === '/api/login' && method === 'POST') return response(await login(body));
    if (!stateKey) fail(401, 'Войдите в редактор.');
    if (path === '/api/logout') {
      stateKey = null; sessionStorage.removeItem(sessionName);
      for (const url of mediaUrls.values()) URL.revokeObjectURL(url); mediaUrls.clear();
      return response({ ok: true });
    }
    if (path === '/api/admin/content' && method === 'GET') return response({ ...(await state()).value.content, csrf: 'local-draft' });
    if (path === '/api/admin/content' && method === 'PUT') return response(await mutate(value => {
      if (body.revision !== value.content.revision) fail(409, 'Контент изменился в другой вкладке. Обновите страницу перед сохранением.');
      const content = validateContent(body);
      for (const path of imagePaths(content)) if (path.startsWith('/media/') && !value.media.some(item => '/media/' + item.id === path)) fail(400, 'Изображение не найдено.');
      value.content = { ...content, revision: value.content.revision + 1 };
      return { ...value.content, csrf: 'local-draft' };
    }));
    if (path === '/api/admin/media' && method === 'GET') {
      const current = (await state()).value;
      return response([...manifest.assets, ...current.media.map(item => ({ id: item.id, name: item.name, mime: item.mime }))]);
    }
    if (path === '/api/admin/media' && method === 'POST') {
      const bytes = decode(body.data);
      if (bytes.length > 8 * 1024 * 1024) fail(413, 'Максимальный размер изображения — 8 МБ.');
      const item = { id: crypto.randomUUID(), name: body.name, mime: mediaType(bytes), data: body.data };
      await mutate(value => { value.media.push(item); });
      mediaUrl(item);
      return response({ id: item.id, name: item.name, url: '/media/' + item.id }, 201);
    }
    if (path.startsWith('/api/admin/media/') && method === 'DELETE') {
      const id = path.split('/').at(-1);
      await mutate(value => {
        if (imagePaths(value.content).includes('/media/' + id)) fail(409, 'Изображение используется на сайте.');
        value.media = value.media.filter(item => item.id !== id);
      });
      return response({ ok: true });
    }
    if (path === '/api/admin/preview') return response({ html: await preview(validateContent(body), (await state()).value.media) });
    if (path === '/api/admin/requests') return response([]);
    fail(404, 'Страница не найдена.');
  } catch (error) { return response({ error: error.message || 'Не удалось выполнить действие.' }, error.status || 400); }
}
function publication(value) {
  const content = normalizeContent(structuredClone(value.content));
  const files = new Map();
  function image(path) {
    if (!path.startsWith('/media/')) return path;
    const item = value.media.find(item => '/media/' + item.id === path);
    if (!item) throw new Error('Изображение не найдено.');
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[item.mime];
    const name = 'image-' + item.id + '.' + extension;
    files.set('public/assets/' + name, decode(item.data)); return '/assets/' + name;
  }
  content.sections = content.sections.filter(row => row.status === 'published');
  content.projects = content.sections.some(row => row.type === 'projects') ? content.projects.filter(row => row.status === 'published') : [];
  content.services = content.sections.some(row => row.type === 'services') ? content.services.filter(row => row.status === 'published') : [];
  content.navigation = content.navigation.filter(row => row.status === 'published');
  content.settings.logo = image(content.settings.logo);
  for (const project of content.projects) { project.image = image(project.image); project.gallery.forEach(item => { item.image = image(item.image); }); }
  for (const section of content.sections) { section.image = image(section.image); section.images.forEach(item => { item.image = image(item.image); }); }
  delete content.revision; delete content.csrf;
  files.set('src/seed.json', new TextEncoder().encode(JSON.stringify(content, null, 2) + '\n'));
  return [...files].map(([path, data]) => ({ path, data }));
}
async function publish(files, token, baseline) {
  const root = 'https://api.github.com/repos/' + manifest.repository;
  async function github(path, method = 'GET', body) {
    const result = await fetch(root + path, { method, headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await result.json();
    if (!result.ok) throw new Error(result.status === 401 ? 'Проверьте токен GitHub.' : result.status === 403 ? 'Токену нужен доступ Contents: Read and write к этому репозиторию.' : 'GitHub не принял изменение. Возможно, репозиторий обновился; черновик сохранён.');
    return data;
  }
  const ref = await github('/git/ref/heads/' + manifest.branch);
  const current = await github('/contents/src/seed.json?ref=' + ref.object.sha);
  if (current.sha !== baseline) throw new Error('Контент в GitHub уже изменился. Скачайте свой черновик архивом перед обновлением редактора.');
  const commit = await github('/git/commits/' + ref.object.sha);
  const tree = [];
  for (const file of files) {
    const blob = await github('/git/blobs', 'POST', { encoding: 'base64', content: encode(file.data) });
    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const nextTree = await github('/git/trees', 'POST', { base_tree: commit.tree.sha, tree });
  const next = await github('/git/commits', 'POST', { message: 'Update website content from Pages editor', tree: nextTree.sha, parents: [ref.object.sha] });
  await github('/git/refs/heads/' + manifest.branch, 'PATCH', { sha: next.sha, force: false });
  return tree.find(item => item.path === 'src/seed.json').sha;
}
function bindActions() {
  const status = document.getElementById('pages-status');
  const download = document.getElementById('pages-download');
  const publishButton = document.getElementById('pages-publish');
  const dialog = document.getElementById('github-dialog');
  const form = document.getElementById('github-form');
  const error = document.getElementById('github-status');
  async function savedFiles() {
    if (!window.pagesAdmin.saveBeforeExport) throw new Error('Подождите загрузки редактора.');
    await window.pagesAdmin.saveBeforeExport();
    const value = (await state()).value; return { value, files: publication(value) };
  }
  download.addEventListener('click', async () => {
    try {
      const { files } = await savedFiles();
      const url = URL.createObjectURL(zip(files));
      const link = document.createElement('a'); link.href = url; link.download = 'landingforyou-update.zip'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status.textContent = 'В архиве — src/seed.json и новые изображения. Загрузите их в репозиторий для публикации.';
    } catch (error) { status.textContent = error.message; }
  });
  publishButton.addEventListener('click', () => { error.textContent = ''; dialog.showModal(); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); const submit = form.querySelector('button[type=submit]'); submit.disabled = true;
    try {
      error.textContent = 'Отправляем обновление…';
      const { value, files } = await savedFiles();
      const sha = await publish(files, form.elements.token.value.trim(), value.baselineSeedSha);
      await mutate(current => { current.baselineSeedSha = sha; });
      dialog.close(); status.textContent = 'Изменения отправлены в GitHub. Обновлённый сайт появится после сборки Pages.';
    } catch (failure) { error.textContent = failure.message; }
    finally { form.elements.token.value = ''; submit.disabled = false; }
  });
}

try {
  if (!crypto.subtle) throw new Error('Редактору нужен HTTPS или localhost.');
  const result = await fetch(new URL('bootstrap.json', import.meta.url), { cache: 'no-store' });
  if (!result.ok) throw new Error('Не удалось загрузить настройки редактора.');
  manifest = await result.json();
  database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('pages-editor:' + base.pathname, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Разрешите хранение данных сайта в браузере.'));
  });
  const session = sessionStorage.getItem(sessionName);
  if (session) {
    try {
      const keys = JSON.parse(session);
      if (keys.salt !== manifest.salt) throw new Error('deployment changed');
      await decrypt(manifest, await importKey(keys.seedKey)); seed = { content: manifest.content };
      stateKey = await importKey(keys.stateKey); stateSalt = keys.stateSalt;
    } catch { sessionStorage.removeItem(sessionName); stateKey = null; }
  }
  if (editorPage && !stateKey) location.replace(loginUrl);
  else {
    if (editorPage) {
      template = await (await fetch(new URL('site-template.html', import.meta.url))).text();
      bindActions();
    }
    window.pagesAdmin = { fetch: api, loginUrl, editorUrl, imageUrl: path => path.startsWith('/media/') ? mediaUrls.get(path.slice(7)) || '' : path.startsWith('/assets/') ? base.pathname + path.slice(1) : path };
    const script = document.createElement('script'); script.src = new URL('../admin.js', import.meta.url); script.onload = () => { const button = document.querySelector('#login-form button'); if (button) button.disabled = false; }; document.head.append(script);
  }
} catch (error) {
  const node = document.getElementById('login-status') || document.getElementById('save-status');
  if (node) { node.textContent = error.message; node.className = 'error'; }
}
