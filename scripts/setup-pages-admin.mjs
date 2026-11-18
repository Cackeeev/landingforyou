import { randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';
import { writeFileSync } from 'node:fs';

if (!process.env.PAGES_ADMIN_PASSWORD) throw new Error('Set PAGES_ADMIN_PASSWORD in your private .env first.');
const salt = randomBytes(16), iv = randomBytes(12), iterations = 210000;
const key = pbkdf2Sync(process.env.PAGES_ADMIN_PASSWORD, salt, iterations, 32, 'sha256');
const cipher = createCipheriv('aes-256-gcm', key, iv);
const data = Buffer.concat([cipher.update(JSON.stringify({ check: 'pages-editor-v1' }), 'utf8'), cipher.final(), cipher.getAuthTag()]);
writeFileSync(new URL('../src/pages-auth.json', import.meta.url), JSON.stringify({
  username: process.env.PAGES_ADMIN_USERNAME || 'admin', salt: salt.toString('base64'),
  iv: iv.toString('base64'), data: data.toString('base64'), iterations
}, null, 2) + '\n');
console.log('Pages editor unlock configuration updated. Plaintext password excluded.');
