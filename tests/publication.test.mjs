import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publishedContent, canonical } from '../src/publication.mjs';
import { normalizeContent } from '../src/content.mjs';
import { validateContent } from '../src/validate.mjs';
import { renderSite, escape } from '../src/render.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/content.json', import.meta.url), 'utf8'));
test('publication comparison ignores revisions and object order while detecting actual website edits', () => {
  const source = normalizeContent(fixture);
  const baseline = canonical(publishedContent(source));
  const reordered = { ...source, revision: 99, csrf: 'local', settings: Object.fromEntries(Object.entries(source.settings).reverse()) };
  assert.equal(canonical(publishedContent(reordered)), baseline);
  reordered.projects[0].description = 'Новый текст';
  assert.notEqual(canonical(publishedContent(reordered)), baseline);
});
test('publication remaps background images and excludes drafts from the uploaded snapshot', () => {
  const source = normalizeContent(fixture);
  source.projects[0].cardTheme = 'image'; source.projects[0].backgroundImage = '/media/test';
  source.projects.push({ ...source.projects[0], id: 'draft', title: 'Черновик', status: 'draft' });
  const result = publishedContent(source, path => path === '/media/test' ? '/assets/photo.png' : path);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].backgroundImage, '/assets/photo.png');
  assert.equal(source.projects[0].backgroundImage, '/media/test');
});
test('current production content supports arbitrary project count without fixture assumptions', () => {
  const source = JSON.parse(readFileSync(new URL('../src/seed.json', import.meta.url), 'utf8'));
  const content = validateContent(source);
  const html = renderSite(content);
  if (content.sections.some(section => section.type === 'projects' && section.status === 'published')) {
    for (const project of content.projects.filter(row => row.status === 'published')) assert.ok(html.includes(escape(project.title)));
  }
});
