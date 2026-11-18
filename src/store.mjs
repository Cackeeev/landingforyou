import { randomBytes, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databasePath = resolve(process.env.DATA_DIR || resolve(root, '.local'), 'portfolio.sqlite');
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(databasePath);
chmodSync(databasePath, 0o600);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS content (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS credentials (username TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL);
  CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT NOT NULL, task TEXT NOT NULL, created TEXT NOT NULL);
`);
db.prepare('INSERT OR IGNORE INTO content VALUES (1, 1, ?)').run(readFileSync(resolve(root, 'src/seed.json'), 'utf8'));

export function readContent() {
  const row = db.prepare('SELECT * FROM content WHERE id=1').get();
  return { revision: row.revision, ...JSON.parse(row.body) };
}

export function saveContent(content, revision) {
  const result = db.prepare('UPDATE content SET body=?, revision=revision+1 WHERE id=1 AND revision=?')
    .run(JSON.stringify(content), revision);
  return result.changes === 1;
}

// Bootstrap only an empty account store. Existing credentials survive redeployments.
if (!db.prepare('SELECT username FROM credentials LIMIT 1').get()) {
  if (process.env.ADMIN_PASSWORD) {
    const salt = randomBytes(32).toString('hex');
    const hash = scryptSync(process.env.ADMIN_PASSWORD, salt, 64).toString('hex');
    db.prepare('INSERT INTO credentials VALUES (?, ?, ?)').run(process.env.ADMIN_USERNAME || 'admin', salt, hash);
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('ADMIN_PASSWORD is required for the first production start.');
  }
}
