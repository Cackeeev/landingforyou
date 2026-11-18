import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

test('server authorization, publishing, requests and persistence', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'landingforyou-test-'));
  const environment = { ...process.env, DATA_DIR: directory, PORT: '0', NODE_ENV: 'test' };
  async function start() {
    const child = spawn(process.execPath, ['src/server.mjs'], { env: environment, stdio: ['ignore','pipe','pipe'] });
    let output = '';
    const address = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => reject(new Error('Server stopped: ' + code)));
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
    });
    return { child, address };
  }
  let server = await start();
  let database = new DatabaseSync(resolve(directory, 'portfolio.sqlite'));
  database.prepare('INSERT INTO credentials VALUES (?, ?, ?)').run('admin', 'test-salt', scryptSync('test-password','test-salt',64).toString('hex'));
  const query = async (path, { cookie, csrf, origin, ...options } = {}) => {
    return fetch(server.address + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Origin: origin || server.address,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {})
      }
    });
  };
  try {
    assert.equal((await query('/health')).status, 200);
    const favicon = await query('/favicon.ico');
    assert.equal(favicon.status, 200);
    assert.match(favicon.headers.get('content-type'), /image\/x-icon/);
    const flame = await (await query('/assets/favicon.svg')).text();
    assert.match(flame, /viewBox="0 0 142 178"/);
    assert.match(await (await query('/')).text(), /href="\/assets\/favicon.svg\?v=2"/);
    assert.equal((await query('/api/admin/content')).status, 401);
    assert.equal((await query('/api/admin/content', { method: 'PUT', body: '{}' })).status, 401);
    assert.match(await (await query('/admin')).text(), /id="login-form"/);
    assert.match(await (await query('/admin/')).text(), /id="login-form"/);
    assert.match(await (await query('/')).text(), /class="button footer-admin" href="\/admin\/">Войти в админку/);
    let response = await query('/api/login', { method: 'POST', body: JSON.stringify({username:'admin',password:'wrong'}) });
    assert.equal(response.status,401);
    response = await query('/api/login', { method:'POST', body:JSON.stringify({username:'admin',password:'test-password'}) });
    assert.equal(response.status,200);
    const cookieHeader = response.headers.get('set-cookie');
    assert.match(cookieHeader,/HttpOnly/);
    assert.match(cookieHeader,/SameSite=Strict/);
    const cookie = cookieHeader.split(';')[0];
    assert.match(await (await query('/admin',{cookie})).text(), /id="editor-area"/);
    let content = await (await query('/api/admin/content',{cookie})).json();
    const csrf = content.csrf;
    assert.equal((await query('/api/admin/content',{cookie,method:'PUT',body:JSON.stringify(content)})).status,403);
    assert.equal((await query('/api/admin/content',{cookie,csrf,origin:'http://external.invalid',method:'PUT',body:JSON.stringify(content)})).status,403);
    const initial = structuredClone(content);
    content.projects.push({
      ...content.projects[0], id: 'second-project', title: 'Второй проект', status: 'draft'
    });
    content.services.push({
      id: 'new-service', title: 'Новая услуга', nav: 'Услуга', description: 'Описание', status: 'published'
    });
    response = await query('/api/admin/content',{cookie,csrf,method:'PUT',body:JSON.stringify(content)});
    assert.equal(response.status,200);
    content = await response.json();
    let html = await (await query('/')).text();
    assert.doesNotMatch(html,/Второй проект/);
    assert.match(html,/Новая услуга/);
    content.projects[1].status = 'published';
    response = await query('/api/admin/content',{cookie,csrf,method:'PUT',body:JSON.stringify(content)});
    content = await response.json();
    assert.match(await (await query('/')).text(),/Второй проект/);
    content.projects = initial.projects;
    content.services = initial.services;
    response = await query('/api/admin/content',{cookie,csrf,method:'PUT',body:JSON.stringify(content)});
    content = await response.json();
    assert.doesNotMatch(await (await query('/')).text(),/Второй проект|Новая услуга/);
    const stale = structuredClone(content);
    content.projects[0].title = 'Изменённый проект';
    response = await query('/api/admin/content',{cookie,csrf,method:'PUT',body:JSON.stringify(content)});
    assert.equal(response.status,200);
    content = await response.json();
    assert.match(await (await query('/')).text(),/Изменённый проект/);
    assert.equal((await query('/api/admin/content',{cookie,csrf,method:'PUT',body:JSON.stringify(stale)})).status,409);
    content.projects[0].status='hidden';
    response=await query('/api/admin/content',{cookie,csrf,method:'PUT',body:JSON.stringify(content)});
    content=await response.json();
    assert.doesNotMatch(await (await query('/')).text(),/Изменённый проект/);
    const preview=await (await query('/api/admin/preview',{cookie,csrf,method:'POST',body:JSON.stringify(content)})).json();
    assert.match(preview.html,/Изменённый проект/);
    assert.doesNotMatch(await (await query('/')).text(),/Изменённый проект/);
    content.settings.about='<script>attack()</script>';
    response=await query('/api/admin/content',{cookie,csrf,method:'PUT',body:JSON.stringify(content)});
    content=await response.json();
    assert.match(await (await query('/')).text(),/&lt;script&gt;attack/);
    response=await query('/api/requests',{method:'POST',body:JSON.stringify({name:'Анна',contact:'@anna',task:'Лендинг'})});
    assert.equal(response.status,201);
    const requests=await (await query('/api/admin/requests',{cookie})).json();
    assert.equal(requests[0].task,'Лендинг');
    const image=readFileSync('public/assets/baltic-logo.png');
    response=await query('/api/admin/media',{cookie,csrf,method:'POST',body:JSON.stringify({name:'logo.png',data:image.toString('base64')})});
    assert.equal(response.status,201);
    const media=await response.json();
    assert.deepEqual(Buffer.from(await (await query(media.url)).arrayBuffer()),image);
    content.settings.contactUrl='https://example.com/contact';
    content.settings.logo=media.url;
    content.settings.accent='#123abc';
    content.projects[0].gallery=[{image:media.url,alt:'Галерея проекта'}];
    content.sections.unshift({id:'new-block',type:'gallery',title:'Новый блок сайта',description:'Описание блока',body:'Текст',image:'',images:[{image:media.url,alt:'Фото блока'}],url:'https://example.com/block',linkLabel:'Перейти',status:'published'});
    content.navigation.push({id:'custom-menu',label:'Новый блок',url:'#new-block',status:'published'});
    response=await query('/api/admin/content',{cookie,csrf,method:'PUT',body:JSON.stringify(content)});
    assert.equal(response.status,200);
    content=await response.json();
    const updated=await (await query('/')).text();
    assert.match(updated,/Новый блок сайта/);
    assert.match(updated,/Фото блока/);
    assert.match(updated,/href="https:\/\/example.com\/contact"/);
    assert.match(await (await query('/theme.css')).text(),/--blue: #123abc/);
    assert.equal((await query('/api/admin/media/'+media.id,{cookie,csrf,method:'DELETE'})).status,409);
    const previewContent=structuredClone(content);
    previewContent.settings.accent='#bb0088';
    const themedPreview=await (await query('/api/admin/preview',{cookie,csrf,method:'POST',body:JSON.stringify(previewContent)})).json();
    assert.match(themedPreview.html,/theme.css\?accent=%23bb0088/);
    assert.match(await (await query('/theme.css?accent=%23bb0088')).text(),/--blue: #bb0088/);
    assert.match(await (await query('/theme.css')).text(),/--blue: #123abc/);
    const missingImage=structuredClone(content);
    missingImage.sections[0].images[0].image='/media/00000000-0000-0000-0000-000000000000';
    assert.equal((await query('/api/admin/content',{cookie,csrf,method:'PUT',body:JSON.stringify(missingImage)})).status,400);
    assert.equal((await query('/api/admin/media',{cookie,csrf,method:'POST',body:JSON.stringify({name:'attack.svg',data:Buffer.from('<svg/>').toString('base64')})})).status,400);
    assert.equal((await query('/.local/portfolio.sqlite')).status,404);
    assert.equal((await query('/src/seed.json')).status,404);
    assert.equal((await query('/api/logout',{cookie,csrf,method:'POST'})).status,200);
    assert.equal((await query('/api/admin/content',{cookie})).status,401);
    database.close();
    database=null;
    const stopped=once(server.child,'exit');
    server.child.kill();
    await stopped;
    server=await start();
    assert.match(await (await query('/')).text(),/&lt;script&gt;attack/);
    assert.match(await (await query('/')).text(),/Новый блок сайта/);
    const persisted=new DatabaseSync(resolve(directory,'portfolio.sqlite'));
    assert.equal(persisted.prepare('SELECT count(*) AS total FROM requests').get().total,1);
    persisted.close();
  } finally {
    database?.close();
    const stopped=once(server.child,'exit');
    server.child.kill();
    await stopped;
    rmSync(directory,{recursive:true,force:true});
  }
});
