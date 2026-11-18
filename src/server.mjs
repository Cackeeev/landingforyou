import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db, root, readContent, saveContent } from './store.mjs';
import { renderSite } from './render.mjs';
import { validateContent } from './validate.mjs';
import { imagePaths, themeCss } from './content.mjs';

const deriveKey = promisify(scrypt);
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const digest = token => createHash('sha256').update(token).digest('hex');
const publicFiles = new Map([
  ['/favicon.ico', ['public/assets/favicon.ico', 'image/x-icon']],
  ['/assets/favicon.svg', ['public/assets/favicon.svg', 'image/svg+xml']],
  ['/assets/favicon-32.png', ['public/assets/favicon-32.png', 'image/png']],
  ['/assets/apple-touch-icon.png', ['public/assets/apple-touch-icon.png', 'image/png']],
  ['/site.css', ['public/site.css', 'text/css']],
  ['/site.js', ['public/site.js', 'text/javascript']],
  ['/admin.css', ['public/admin.css', 'text/css']],
  ['/admin.js', ['public/admin.js', 'text/javascript']],
  ['/assets/baltic-logo.png', ['public/assets/baltic-logo.png', 'image/png']],
  ['/assets/wordmark.webp', ['public/assets/wordmark.webp', 'image/webp']]
]);
const attempts = new Map();
function fail(status, message) { throw Object.assign(new Error(message), { status }); }

async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Нужен JSON.');
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 12 * 1024 * 1024) fail(413, 'Файл слишком большой. Максимум 8 МБ.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks)); } catch { fail(400, 'Некорректный запрос.'); }
}

function session(req) {
  const token = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('session='))?.slice(8);
  if (!token) return null;
  return db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(digest(token), Date.now());
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  const expected = process.env.PUBLIC_ORIGIN || (process.env.RENDER_EXTERNAL_URL
    ? new URL(process.env.RENDER_EXTERNAL_URL).origin
    : `http://${req.headers.host}`);
  if (origin !== expected) fail(403, 'Недопустимый источник запроса.');
}

function rateLimit(req, kind, max) {
  const key = kind + req.socket.remoteAddress;
  const now = Date.now();
  const previous = attempts.get(key);
  const count = !previous || now - previous.start > 900000 ? { start: now, count: 0 } : previous;
  count.count++;
  attempts.set(key, count);
  if (count.count > max) fail(429, 'Слишком много попыток. Повторите позже.');
}

function mediaType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  return null;
}

export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Cache-Control', 'no-store');
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type + (type.startsWith('text/') || type === 'application/json' ? '; charset=utf-8' : '') });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  try {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;
    const auth = session(req);
    const mutation = !['GET', 'HEAD'].includes(req.method);
    if (mutation) sameOrigin(req);

    if (req.method === 'POST' && path === '/api/login') {
      rateLimit(req, 'login', 20);
      const body = await jsonBody(req);
      const credentials = typeof body.username === 'string'
        ? db.prepare('SELECT * FROM credentials WHERE username=?').get(body.username) : null;
      const calculated = await deriveKey(typeof body.password === 'string' ? body.password : '', credentials?.salt || 'invalid-account', 64);
      if (!credentials || !timingSafeEqual(calculated, Buffer.from(credentials.hash, 'hex'))) fail(401, 'Неверный логин или пароль.');
      const token = randomBytes(32).toString('hex');
      const csrf = randomBytes(32).toString('hex');
      db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), csrf, Date.now() + 12 * 3600000);
      res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${(process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL)?.startsWith('https:') ? '; Secure' : ''}`);
      send(200, { ok: true });
      return;
    }

    if (path.startsWith('/api/admin') || path === '/api/logout') {
      if (!auth) fail(401, 'Войдите в админку.');
      if (mutation && req.headers['x-csrf-token'] !== auth.csrf) fail(403, 'Обновите страницу и повторите действие.');
      if (path === '/api/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE hash=?').run(auth.hash);
        res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        send(200, { ok: true });
        return;
      }
      if (path === '/api/admin/content' && req.method === 'GET') {
        send(200, { ...readContent(), csrf: auth.csrf });
        return;
      }
      if (path === '/api/admin/content' && req.method === 'PUT') {
        const body = await jsonBody(req);
        let content;
        try { content = validateContent(body); } catch (error) { fail(400, error.message); }
        for (const path of imagePaths(content)) {
          if (path.startsWith('/media/') && !db.prepare('SELECT id FROM media WHERE id=?').get(path.slice(7))) fail(400, 'Изображение не найдено.');
        }
        if (!saveContent(content, body.revision)) fail(409, 'Контент изменился в другой вкладке. Обновите страницу перед сохранением.');
        send(200, { ...readContent(), csrf: auth.csrf });
        return;
      }
      if (path === '/api/admin/preview' && req.method === 'POST') {
        const body = await jsonBody(req);
        let content;
        try { content = validateContent(body); } catch (error) { fail(400, error.message); }
        // A preview uses the same renderer and is never written to public content.
        content.projects = content.projects.map(item => ({ ...item, status: 'published' }));
        content.services = content.services.map(item => ({ ...item, status: 'published' }));
        content.sections = content.sections.map(item => ({ ...item, status: 'published' }));
        content.navigation = content.navigation.map(item => ({ ...item, status: 'published' }));
        // Preview the unsaved palette without writing it to the live theme.
        const palette = '/theme.css?accent=' + encodeURIComponent(content.settings.accent) + '&amp;paper=' + encodeURIComponent(content.settings.paper);
        send(200, { html: renderSite(content).replace('href="/theme.css"', `href="${palette}"`) });
        return;
      }
      if (path === '/api/admin/media' && req.method === 'GET') {
        const names = { 'wordmark.webp': 'Логотип Landingforyou', 'baltic-logo.png': 'Биосфера Балтики' };
        const assets = readdirSync(resolve(root, 'public/assets'))
          .filter(name => /^[a-zA-Z0-9._-]+\.(png|jpe?g|webp)$/.test(name) && !/^(favicon|apple-touch-icon)/.test(name))
          .map(name => ({ id: 'asset-' + name, name: names[name] || name, url: '/assets/' + name }));
        send(200, [...assets, ...db.prepare('SELECT id, name, mime FROM media ORDER BY rowid DESC').all()]);
        return;
      }
      if (path === '/api/admin/media' && req.method === 'POST') {
        const body = await jsonBody(req);
        if (typeof body.data !== 'string' || typeof body.name !== 'string') fail(400, 'Выберите файл.');
        const bytes = Buffer.from(body.data, 'base64');
        if (bytes.length > 8 * 1024 * 1024) fail(413, 'Максимальный размер изображения — 8 МБ.');
        const mime = mediaType(bytes);
        if (!mime) fail(400, 'Используйте PNG, JPEG или WebP.');
        const id = randomUUID();
        db.prepare('INSERT INTO media VALUES (?, ?, ?, ?)').run(id, body.name, mime, bytes);
        send(201, { id, name: body.name, url: '/media/' + id });
        return;
      }
      if (path.startsWith('/api/admin/media/') && req.method === 'DELETE') {
        const id = path.split('/').pop();
        if (imagePaths(readContent()).includes('/media/' + id)) fail(409, 'Изображение используется на сайте.');
        db.prepare('DELETE FROM media WHERE id=?').run(id);
        send(200, { ok: true });
        return;
      }
      if (path === '/api/admin/requests' && req.method === 'GET') {
        send(200, db.prepare('SELECT * FROM requests ORDER BY created DESC').all());
        return;
      }
      fail(404, 'Страница не найдена.');
    }

    if (path === '/api/requests' && req.method === 'POST') {
      rateLimit(req, 'requests', 15);
      const body = await jsonBody(req);
      if (['name','contact','task'].some(key => typeof body[key] !== 'string' || !body[key].trim())) fail(400, 'Заполните имя, контакт и задачу.');
      const values = ['name','contact','task'].map(key => body[key].trim());
      db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?)').run(randomUUID(), ...values, new Date().toISOString());
      send(201, { ok: true });
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Метод не поддерживается.');
    if (path === '/health') {
      db.prepare('SELECT revision FROM content WHERE id=1').get();
      send(200, { ok: true });
      return;
    }
    if (path === '/theme.css') {
      const settings = readContent().settings;
      send(200, themeCss({ ...settings, accent: url.searchParams.get('accent') || settings.accent, paper: url.searchParams.get('paper') || settings.paper }), 'text/css');
      return;
    }
    if (path === '/' || path === '/index.html') {
      send(200, renderSite(readContent()), 'text/html');
      return;
    }
    if (path === '/admin' || path === '/admin/') {
      send(200, readFileSync(resolve(root, auth ? 'templates/admin.html' : 'templates/login.html')), 'text/html');
      return;
    }
    if (path.startsWith('/media/')) {
      const media = db.prepare('SELECT mime, bytes FROM media WHERE id=?').get(path.slice(7));
      if (!media) fail(404, 'Изображение не найдено.');
      send(200, Buffer.from(media.bytes), media.mime);
      return;
    }
    const file = publicFiles.get(path);
    if (file) {
      send(200, readFileSync(resolve(root, file[0])), file[1]);
      return;
    }
    if (/^\/assets\/[a-zA-Z0-9._-]+\.(png|jpe?g|webp)$/.test(path)) {
      const mime = path.endsWith('.webp') ? 'image/webp' : /\.jpe?g$/.test(path) ? 'image/jpeg' : 'image/png';
      let bytes;
      try { bytes = readFileSync(resolve(root, 'public', path.slice(1))); } catch { fail(404, 'Изображение не найдено.'); }
      send(200, bytes, mime);
      return;
    }
    fail(404, 'Страница не найдена.');
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error(error);
    send(status, { error: status === 500 ? 'Не удалось выполнить действие. Повторите позже.' : error.message });
  }
});
server.listen(port, host, () => console.log(`Landingforyou: http://${host}:${server.address().port}`));
