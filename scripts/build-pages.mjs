import { mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { randomBytes, pbkdf2Sync, createCipheriv, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { renderSite, escape } from '../src/render.mjs';
import { root, db } from '../src/store.mjs';
import { normalizeContent, themeCss } from '../src/content.mjs';

const source = readFileSync(resolve(root, 'src/seed.json'));
const seedSha = createHash('sha1').update('blob ' + source.length + '\0').update(source).digest('hex');
const content = normalizeContent(JSON.parse(source.toString('utf8')));
const base = process.env.PAGES_BASE_PATH || '/landingforyou/';
if (!/^\/[a-zA-Z0-9_/-]*\/$/.test(base) && base !== '/') throw new Error('PAGES_BASE_PATH must start and end with /.');
let adminUrl = '';
if (process.env.ADMIN_URL) {
  const url = new URL(process.env.ADMIN_URL);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('ADMIN_URL must be an HTTP(S) URL without credentials.');
  }
  adminUrl = escape(url.href);
}
const output = resolve(root, 'dist');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(resolve(root, 'public/assets'), resolve(output, 'assets'), { recursive: true });
cpSync(resolve(root, 'public/site.css'), resolve(output, 'site.css'));
cpSync(resolve(root, 'public/site.js'), resolve(output, 'site.js'));
cpSync(resolve(root, 'public/admin.css'), resolve(output, 'admin.css'));
let html = renderSite(content);
html = html.replace(/<p class="contact-divider">.*?<\/form>/s, '');
html = html.replace(/(href|src)="\/(?!\/)/g, (_, attribute) => attribute + '="' + base);
writeFileSync(resolve(output, 'index.html'), html);
writeFileSync(resolve(output, 'theme.css'), themeCss(content.settings, content.projects));
writeFileSync(resolve(output, 'admin-deployment.json'), JSON.stringify({ commitSha: process.env.GITHUB_SHA || '', seedSha, builtAt: new Date().toISOString() }));
mkdirSync(resolve(output, 'admin'), { recursive: true });
const adminEntry = readFileSync(resolve(root, 'templates/admin-entry.html'), 'utf8')
  .replaceAll('{{BASE}}', base)
  .replace('{{REDIRECT}}', adminUrl ? `<meta http-equiv="refresh" content="0;url=${adminUrl}">` : '')
  .replace('{{TITLE}}', adminUrl ? 'Вход в админку' : 'Админка ещё не подключена')
  .replace('{{MESSAGE}}', adminUrl ? 'Переходим на страницу входа…' : 'Управление контентом станет доступно после подключения админки.')
  .replace('{{ADMIN_LINK}}', adminUrl ? `<a class="button primary" href="${adminUrl}">Войти в админку</a>` : '');
if (adminUrl) {
  writeFileSync(resolve(output, 'admin/index.html'), adminEntry);
} else {
  let authentication;
  if (process.env.PAGES_ADMIN_PASSWORD) {
    const salt = randomBytes(16), iv = randomBytes(12), iterations = 210000;
    const key = pbkdf2Sync(process.env.PAGES_ADMIN_PASSWORD, salt, iterations, 32, 'sha256');
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify({ check: 'pages-editor-v1' }), 'utf8'), cipher.final(), cipher.getAuthTag()]);
    authentication = { username: process.env.PAGES_ADMIN_USERNAME || 'admin', salt: salt.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64'), iterations };
  } else {
    authentication = JSON.parse(readFileSync(resolve(root, 'src/pages-auth.json'), 'utf8'));
  }
  const names = { 'wordmark.webp': 'Логотип Landingforyou', 'baltic-logo.png': 'Биосфера Балтики' };
  const assets = readdirSync(resolve(root, 'public/assets')).filter(name => /^[a-zA-Z0-9._-]+\.(png|jpe?g|webp)$/.test(name) && !/^(favicon|apple-touch-icon)/.test(name))
    .map(name => ({ name: names[name] || name, url: '/assets/' + name }));
  writeFileSync(resolve(output, 'admin/bootstrap.json'), JSON.stringify({ ...authentication, content, seedSha, repository: process.env.GITHUB_REPOSITORY || 'Cackeeev/landingforyou', branch: 'main', assets }));
  mkdirSync(resolve(output, 'admin/shared'), { recursive: true });
  for (const file of ['content.mjs', 'validate.mjs', 'public-render.mjs', 'publication.mjs']) cpSync(resolve(root, 'src', file), resolve(output, 'admin/shared', file));
  for (const file of ['admin-pages.mjs', 'admin-crypto.mjs', 'admin-zip.mjs']) cpSync(resolve(root, 'public', file), resolve(output, 'admin', file));
  cpSync(resolve(root, 'public/admin.js'), resolve(output, 'admin.js'));
  cpSync(resolve(root, 'templates/site.html'), resolve(output, 'admin/site-template.html'));
  const prepare = html => html.replace('<script defer src="/admin.js"></script>', '<script type="module" src="/admin/admin-pages.mjs"></script>').replace(/(href|src)="\/(?!\/)/g, (_, attribute) => attribute + '=\"' + base);
  const login = readFileSync(resolve(root, 'templates/login.html'), 'utf8').replace('<form id="login-form"', '<p class="notice">Редактор GitHub Pages. Черновики сохраняются на этом устройстве.</p><form method="post" id="login-form"');
  let editor = readFileSync(resolve(root, 'templates/admin.html'), 'utf8');
  editor = editor.replace('<div class="admin-layout">', `<section class="pages-notice"><p>Черновики сохраняются в этом браузере. Для обновления сайта отправьте изменения в GitHub или скачайте архив.</p><div class="header-actions"><button id="pages-publish" class="primary">Опубликовать в GitHub</button><button id="pages-download">Скачать обновление</button><button id="pages-check" hidden>Проверить публикацию</button></div><p id="pages-status" role="status"></p></section><div class="admin-layout">`);
  editor = editor.replace('</body>', `<dialog class="github-dialog" id="github-dialog"><form method="dialog"><button aria-label="Закрыть публикацию">Закрыть ×</button></form><h2>Публикация в GitHub</h2><p>Укажите токен для репозитория landingforyou с правом Contents: Read and write. Токен используется только для этой публикации и не сохраняется.</p><p><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Создать токен GitHub ↗</a></p><form class="fields" id="github-form"><label>Токен GitHub<input name="token" type="password" autocomplete="off" required></label><button type="submit" class="primary">Отправить обновление</button><p id="github-status" role="status"></p></form></dialog></body>`);
  writeFileSync(resolve(output, 'admin/index.html'), prepare(login.replace('<button class="primary">', '<button class="primary" disabled>')));
  writeFileSync(resolve(output, 'admin/editor.html'), prepare(editor));
}
writeFileSync(resolve(output, '.nojekyll'), '');
db.close();
console.log('GitHub Pages build ready in dist.');
