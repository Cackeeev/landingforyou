import { scryptSync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { db } from '../src/store.mjs';

const reader = createInterface({ input: process.stdin, output: process.stdout });
const username = (await reader.question('Login: ')).trim();
const password = await reader.question('Password: ');
reader.close();
if (!username || !password) throw new Error('Login and password are required');
const salt = randomBytes(32).toString('hex');
const hash = scryptSync(password, salt, 64).toString('hex');
db.prepare('INSERT OR REPLACE INTO credentials VALUES (?, ?, ?)').run(username, salt, hash);
db.exec('DELETE FROM sessions');
db.close();
console.log('Admin account saved.');
