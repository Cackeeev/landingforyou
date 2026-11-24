import { normalizeContent, imagePaths, themeCss } from './shared/content.mjs';
import { validateContent } from './shared/validate.mjs';
import { publishedContent, canonical } from './shared/publication.mjs';
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
let currentState, editorContent, editorBusy = false, publishing = false, monitoring = '';

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
  if (!stored) {
    const value = { content: { ...normalizeContent(seed.content), revision: 1 }, media: [], baselineSeedSha: manifest.seedSha };
    currentState = value; refreshPublicationUi(); return { stored, value };
  }
  if (stored.salt !== stateSalt) fail(401, 'Откройте редактор заново.');
  const value = await decrypt(stored, stateKey);
  value.content = normalizeContent(value.content);
  value.media.forEach(mediaUrl); currentState = value; refreshPublicationUi();
  return { stored, value };
}
function mutate(action) {
  const work = queue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await state();
      const result = action(current.value);
      const version = (current.stored?.version || 0) + 1;
      const encrypted = await encrypt(current.value, stateKey);
      try { await write(version - 1, { ...encrypted, salt: stateSalt, version }); currentState = current.value; refreshPublicationUi(); return result; }
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
  let html = renderContent(content, template).replace('href="/theme.css"', 'href="data:text/css,' + encodeURIComponent(themeCss(content.settings, content.projects)) + '"');
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
function publication(value, includeImages = true) {
  const files = new Map();
  const content = publishedContent(value.content, path => {
    if (!path.startsWith('/media/')) return path;
    const item = value.media.find(item => '/media/' + item.id === path);
    if (!item) throw new Error('Изображение не найдено.');
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[item.mime];
    const name = 'image-' + item.id + '.' + extension;
    if (includeImages) files.set('public/assets/' + name, decode(item.data));
    return '/assets/' + name;
  });
  files.set('src/seed.json', new TextEncoder().encode(JSON.stringify(content, null, 2) + '\n'));
  return { content, files: [...files].map(([path, data]) => ({ path, data })) };
}
function needsPublication() {
  if (!currentState || !editorContent) return false;
  try {
    const candidate = publication({ ...currentState, content: editorContent }, false).content;
    const baseline = publishedContent(currentState.lastSubmittedContent || manifest.content);
    return canonical(candidate) !== canonical(baseline);
  } catch { return true; }
}
function refreshPublicationUi() {
  if (!editorPage || !currentState) return;
  const button = document.getElementById('pages-publish');
  const status = document.getElementById('pages-status');
  if (!button || !status) return;
  const pending = currentState.pendingDeployment;
  const changed = needsPublication();
  const failed = pending?.status === 'failed';
  button.disabled = publishing || editorBusy || (!changed && !failed);
  button.textContent = publishing ? 'Отправляем изменения…' : failed ? 'Повторить публикацию' : 'Опубликовать в GitHub';
  status.classList.toggle('error', failed);
  let text = changed ? 'Есть изменения для публикации на сайте.' : 'На сайте опубликована эта версия. Новых изменений нет.';
  if (pending) text = failed ? 'Не опубликовано: сборка или размещение Pages завершились ошибкой. Черновик сохранён.' : pending.status === 'unknown' ? 'GitHub принял изменения, но размещение сайта пока не подтверждено. Проверьте статус публикации.' : 'GitHub принял изменения. Ждём успешной сборки и размещения сайта…';
  else if (currentState.lastDeployment?.status === 'success') text = changed ? 'Предыдущая версия опубликована. Есть новые изменения для публикации.' : 'Опубликовано на сайте. Новых изменений нет.';
  status.replaceChildren(document.createTextNode(text));
  if (pending?.runUrl) {
    const link = document.createElement('a'); link.href = pending.runUrl; link.textContent = ' Открыть сборку'; link.target = '_blank'; link.rel = 'noopener'; status.append(link);
  }
  const check = document.getElementById('pages-check');
  if (check) check.hidden = !pending;
  if (pending && !['failed', 'unknown'].includes(pending.status)) watchDeployment(pending);
}
function watchDeployment(pending) {
  if (monitoring === pending.commitSha) return;
  monitoring = pending.commitSha;
  void monitorDeployment(pending).catch(() => {}).finally(() => { if (monitoring === pending.commitSha) monitoring = ''; });
}
async function monitorDeployment(pending) {
  const commitSha = pending.commitSha;
  const stillCurrent = () => currentState?.pendingDeployment?.commitSha === commitSha;
  const finish = async (status, runUrl = '') => {
    await mutate(value => {
      if (value.pendingDeployment?.commitSha !== commitSha) return;
      if (status === 'success') { value.lastDeployment = { ...value.pendingDeployment, status, runUrl }; value.pendingDeployment = null; }
      else value.pendingDeployment = { ...value.pendingDeployment, status, runUrl: runUrl || value.pendingDeployment.runUrl };
    });
  };
  for (let attempt = 0; attempt < 45 && stillCurrent(); attempt++) {
    try {
      const url = new URL('admin-deployment.json', base); url.searchParams.set('check', Date.now());
      const result = await fetch(url, { cache: 'no-store' });
      if (result.ok) {
        const deployed = await result.json();
        if (deployed.seedSha === pending.seedSha) { await finish('success'); return; }
      }
    } catch {}
    if (!stillCurrent()) return;
    try {
      const result = await fetch('https://api.github.com/repos/' + manifest.repository + '/actions/workflows/pages.yml/runs?head_sha=' + encodeURIComponent(commitSha) + '&per_page=1', { headers: { Accept: 'application/vnd.github+json' } });
      if (result.ok) {
        const run = (await result.json()).workflow_runs?.[0];
        if (run && run.status === 'completed' && run.conclusion !== 'success') { await finish('failed', run.html_url); return; }
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 4000));
  }
  if (stillCurrent()) await finish('unknown');
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
  return { seedSha: tree.find(item => item.path === 'src/seed.json').sha, commitSha: next.sha };
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
    const value = (await state()).value; return { value, ...publication(value) };
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
  publishButton.addEventListener('click', () => { if (publishButton.disabled) return; error.textContent = ''; dialog.showModal(); });
  document.getElementById('pages-check')?.addEventListener('click', () => { if (currentState?.pendingDeployment) watchDeployment(currentState.pendingDeployment); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (publishing) return; const submit = form.querySelector('button[type=submit]'); submit.disabled = true; publishing = true; refreshPublicationUi();
    try {
      error.textContent = 'Отправляем обновление…';
      const { value, content, files } = await savedFiles();
      if (!needsPublication() && value.pendingDeployment?.status !== 'failed') { dialog.close(); return; }
      const result = await publish(files, form.elements.token.value.trim(), value.baselineSeedSha);
      await mutate(current => { current.baselineSeedSha = result.seedSha; current.lastSubmittedContent = content; current.pendingDeployment = { ...result, status: 'building', submittedAt: Date.now() }; });
      dialog.close();
    } catch (failure) { error.textContent = failure.message; }
    finally { form.elements.token.value = ''; submit.disabled = false; publishing = false; refreshPublicationUi(); }
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
    window.pagesAdmin = { onEditorChange: (content, flags) => { editorContent = content; editorBusy = flags.busy || flags.uploads > 0; refreshPublicationUi(); }, fetch: api, loginUrl, editorUrl, imageUrl: path => path.startsWith('/media/') ? mediaUrls.get(path.slice(7)) || '' : path.startsWith('/assets/') ? base.pathname + path.slice(1) : path };
    const script = document.createElement('script'); script.src = new URL('../admin.js', import.meta.url); script.onload = () => { const button = document.querySelector('#login-form button'); if (button) button.disabled = false; }; document.head.append(script);
  }
} catch (error) {
  const node = document.getElementById('login-status') || document.getElementById('save-status');
  if (node) { node.textContent = error.message; node.className = 'error'; }
}
