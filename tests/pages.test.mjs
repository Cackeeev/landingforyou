import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { normalizeContent } from '../src/content.mjs';

test('Pages retains the footer admin entry and redirects only to a configured HTTP(S) login', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'landingforyou-pages-'));
  try {
    for (const path of ['src', 'scripts', 'templates', 'public', 'package.json']) {
      cpSync(resolve(path), resolve(directory, path), { recursive: true });
    }
    const build = (base, adminUrl = '') => spawnSync(process.execPath, ['scripts/build-pages.mjs'], {
      cwd: directory,
      env: { ...process.env, NODE_ENV: 'test', DATA_DIR: resolve(directory, 'data'), PAGES_BASE_PATH: base, ADMIN_URL: adminUrl },
      encoding: 'utf8'
    });
    for (const base of ['/landingforyou/', '/']) {
      const result = build(base);
      assert.equal(result.status, 0, result.stderr);
      const home = readFileSync(resolve(directory, 'dist/index.html'), 'utf8');
      const admin = readFileSync(resolve(directory, 'dist/admin/index.html'), 'utf8');
      assert.ok(home.includes(`href="${base}admin/">Войти в админку`));
      assert.match(admin, /Админка ещё не подключена/);
      assert.ok(admin.includes(`href="${base}admin.css"`));
      assert.ok(admin.includes(`href="${base}">Вернуться на сайт`));
      assert.doesNotMatch(admin, /<form|http-equiv="refresh"|{{/);
      assert.ok(existsSync(resolve(directory, 'dist/admin.css')));
      assert.equal(existsSync(resolve(directory, 'dist/admin.js')), false);
    }
    const result = build('/landingforyou/', 'https://admin.example/admin/?from=footer&lang=ru');
    assert.equal(result.status, 0, result.stderr);
    const admin = readFileSync(resolve(directory, 'dist/admin/index.html'), 'utf8');
    assert.match(admin, /http-equiv="refresh" content="0;url=https:\/\/admin.example\/admin\/\?from=footer&amp;lang=ru"/);
    assert.match(admin, /href="https:\/\/admin.example\/admin\/\?from=footer&amp;lang=ru"/);
    assert.doesNotMatch(admin, /Админка ещё не подключена|<form|{{/);
    for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:password@admin.example/admin/', '/admin/']) {
      assert.notEqual(build('/landingforyou/', url).status, 0, url);
    }
    const content = normalizeContent(JSON.parse(readFileSync(resolve(directory, 'src/seed.json'), 'utf8')));
    const database = new DatabaseSync(resolve(directory, 'data/portfolio.sqlite'));
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const privateId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const image = readFileSync(resolve(directory, 'public/assets/baltic-logo.png'));
    for (const mediaId of [id, privateId]) database.prepare('INSERT INTO media VALUES (?, ?, ?, ?)').run(mediaId, 'test.png', 'image/png', image);
    content.settings.logo = '/media/' + id;
    content.settings.accent = '#123abc';
    content.projects[0].gallery = [{ image: '/media/' + id, alt: 'Галерея проекта' }];
    const block = { id: 'photo-block', type: 'gallery', title: 'Галерея блока', description: '', body: '', image: '', images: [{ image: '/media/' + id, alt: 'Фото' }], url: '', linkLabel: '', status: 'published' };
    content.sections.push(block, { ...block, id: 'secret-block', title: 'DRAFT-SECRET', status: 'draft', images: [{ image: '/media/' + privateId, alt: '' }] });
    database.prepare('UPDATE content SET body=? WHERE id=1').run(JSON.stringify(content));
    database.close();
    const exported = spawnSync(process.execPath, ['scripts/export-content.mjs'], {
      cwd: directory, env: { ...process.env, NODE_ENV: 'test', DATA_DIR: resolve(directory, 'data') }, encoding: 'utf8'
    });
    assert.equal(exported.status, 0, exported.stderr);
    const exportedText = readFileSync(resolve(directory, 'src/seed.json'), 'utf8');
    assert.doesNotMatch(exportedText, /\/media\/|DRAFT-SECRET|secret-block/);
    const published = JSON.parse(exportedText);
    assert.equal(published.settings.logo, '/assets/image-' + id + '.png');
    assert.equal(published.projects[0].gallery[0].image, published.settings.logo);
    assert.equal(published.sections.at(-1).images[0].image, published.settings.logo);
    assert.equal(readdirSync(resolve(directory, 'public/assets')).filter(name => name.startsWith('image-')).length, 1);
    assert.equal(build('/landingforyou/').status, 0);
    assert.match(readFileSync(resolve(directory, 'dist/theme.css'), 'utf8'), /--blue: #123abc/);
    assert.ok(existsSync(resolve(directory, 'dist/assets/image-' + id + '.png')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
