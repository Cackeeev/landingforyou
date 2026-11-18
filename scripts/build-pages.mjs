import { mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderSite, escape } from '../src/render.mjs';
import { root, db } from '../src/store.mjs';
import { normalizeContent, themeCss } from '../src/content.mjs';

const content = normalizeContent(JSON.parse(readFileSync(resolve(root, 'src/seed.json'), 'utf8')));
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
writeFileSync(resolve(output, 'theme.css'), themeCss(content.settings));
mkdirSync(resolve(output, 'admin'), { recursive: true });
const adminEntry = readFileSync(resolve(root, 'templates/admin-entry.html'), 'utf8')
  .replaceAll('{{BASE}}', base)
  .replace('{{REDIRECT}}', adminUrl ? `<meta http-equiv="refresh" content="0;url=${adminUrl}">` : '')
  .replace('{{TITLE}}', adminUrl ? 'Вход в админку' : 'Админка ещё не подключена')
  .replace('{{MESSAGE}}', adminUrl ? 'Переходим на страницу входа…' : 'Управление контентом станет доступно после подключения админки.')
  .replace('{{ADMIN_LINK}}', adminUrl ? `<a class="button primary" href="${adminUrl}">Войти в админку</a>` : '');
writeFileSync(resolve(output, 'admin/index.html'), adminEntry);
writeFileSync(resolve(output, '.nojekyll'), '');
db.close();
console.log('GitHub Pages build ready in dist.');
