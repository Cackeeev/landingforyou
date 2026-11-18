import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
