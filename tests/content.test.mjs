import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeContent, imagePaths, themeCss } from '../src/content.mjs';
import { validateContent, link } from '../src/validate.mjs';
import { renderSite } from '../src/render.mjs';

const seed = JSON.parse(readFileSync(new URL('../src/seed.json', import.meta.url), 'utf8'));
const fresh = () => normalizeContent(structuredClone(seed));
const block = (id, type = 'text') => ({ id, type, status: 'published', title: id, description: '', body: 'Текст блока', image: '', images: [], url: '', linkLabel: '' });

test('old content gains editable defaults without losing projects, text or explicit empty sections', () => {
  const result = validateContent(structuredClone(seed));
  assert.equal(result.projects[0].title, seed.projects[0].title);
  assert.equal(result.settings.about, seed.settings.about);
  assert.equal(result.settings.contactUrl, 'https://t.me/' + seed.settings.telegram);
  assert.deepEqual(result.sections.map(row => row.type), ['projects', 'services', 'about', 'contact']);
  const content = fresh(); content.sections = []; content.navigation = [];
  assert.equal(validateContent(content).sections.length, 0);
  assert.doesNotMatch(renderSite(content), /class="work pad"|class="services pad"|data-open="case-/);
});

test('custom blocks, projects, galleries and navigation preserve order and exclude hidden content', () => {
  const content = fresh();
  content.sections.unshift(block('new-copy'), { ...block('new-gallery', 'gallery'), images: [{ image: '/assets/baltic-logo.png', alt: 'Первое фото' }] });
  content.sections.push({ ...block('hidden-copy'), status: 'hidden', body: 'HIDDEN-BODY' });
  content.projects[0].gallery = [{ image: '/assets/baltic-logo.png', alt: 'Скриншот проекта' }];
  content.projects[0].url = 'https://example.com/project'; content.projects[0].linkLabel = 'Посетить проект';
  content.navigation.push({ id: 'new-link', label: 'Новый раздел', url: '#new-copy', status: 'published' }, { id: 'hidden-link', label: 'HIDDEN-NAV', url: '#hidden-copy', status: 'published' });
  const validated = validateContent(content);
  const html = renderSite(validated);
  assert.ok(html.indexOf('id="new-copy"') < html.indexOf('id="new-gallery"'));
  assert.ok(html.indexOf('id="new-gallery"') < html.indexOf('id="work"'));
  assert.match(html, /href="#new-copy">Новый раздел/);
  assert.match(html, /Скриншот проекта/);
  assert.match(html, /Посетить проект/);
  assert.doesNotMatch(html, /HIDDEN-BODY|HIDDEN-NAV/);
  validated.sections.find(row => row.type === 'projects').status = 'hidden';
  assert.doesNotMatch(renderSite(validated), /case-baltic|href="#work"/);
});

test('editable links accept Telegram and other destinations and reject executable URLs', () => {
  assert.equal(link('@NewContact'), 'https://t.me/NewContact');
  assert.equal(link('t.me/NewContact'), 'https://t.me/NewContact');
  for (const address of ['https://example.com/page', 'mailto:hello@example.com', 'tel:+79990000000', '#contact']) assert.equal(link(address), address);
  for (const address of ['javascript:alert(1)', 'data:text/html,test', '//example.com', 'https://user:password@example.com', '#bad"']) assert.throws(() => link(address));
  const content = fresh(); content.settings.contactUrl = 'https://example.com/contact'; content.settings.contactMode = 'link';
  content.settings.contactLinkLabel = 'Написать на сайте';
  const html = renderSite(validateContent(content));
  assert.match(html, /href="https:\/\/example.com\/contact"/);
  assert.match(html, /Написать на сайте/);
  assert.doesNotMatch(html, /data-open="contact-dialog"/);
});

test('all editable text is escaped, and themes and section identifiers are validated', () => {
  const content = fresh();
  content.settings.siteTitle = '<script>alert(1)</script>';
  content.sections.push({ ...block('escaped-copy'), title: '<img onerror=attack()>', body: '<script>attack()</script>\n\nВторой абзац' });
  const html = renderSite(validateContent(content));
  assert.match(html, /&lt;script&gt;attack/);
  assert.match(html, /&lt;img onerror=attack\(\)&gt;/);
  assert.doesNotMatch(html, /<script>attack|<img onerror/);
  content.settings.accent = '#aabbcc';
  assert.match(themeCss(validateContent(content).settings), /--blue: #aabbcc/);
  content.settings.accent = 'red; display:none'; assert.throws(() => validateContent(content));
  content.settings.accent = '#123456'; content.sections.push(block('top')); assert.throws(() => validateContent(content));
  content.sections.pop(); content.sections.push({ ...block('duplicate-work'), type: 'projects' }); assert.throws(() => validateContent(content));
});

test('logo, block and project gallery images are all tracked for media protection and export', () => {
  const content = fresh();
  content.settings.logo = '/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  content.projects[0].gallery.push({ image: '/media/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', alt: '' });
  content.sections.push({ ...block('image-block', 'image'), image: '/media/cccccccc-cccc-cccc-cccc-cccccccccccc' });
  content.sections.push({ ...block('gallery-block', 'gallery'), images: [{ image: '/media/dddddddd-dddd-dddd-dddd-dddddddddddd', alt: '' }] });
  const paths = imagePaths(validateContent(content));
  for (const prefix of ['a', 'b', 'c', 'd']) assert.ok(paths.some(path => path.startsWith('/media/' + prefix)));
});
