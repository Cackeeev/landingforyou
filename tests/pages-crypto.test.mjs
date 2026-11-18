import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { passwordKey, encrypt, decrypt, encode, exportKey, importKey } from '../public/admin-crypto.mjs';
import { zip } from '../public/admin-zip.mjs';

test('browser drafts encrypt, reopen with session keys and reject the wrong password', async () => {
  const salt = encode(crypto.getRandomValues(new Uint8Array(16)));
  const key = await passwordKey('test-only-password', salt);
  const encrypted = await encrypt({ title: 'Черновик', media: ['picture'] }, key);
  assert.equal(JSON.stringify(encrypted).includes('Черновик'), false);
  assert.deepEqual(await decrypt(encrypted, await importKey(await exportKey(key))), { title: 'Черновик', media: ['picture'] });
  const wrongKey = await passwordKey('incorrect', salt);
  await assert.rejects(() => decrypt(encrypted, wrongKey));
});

test('downloaded update ZIP preserves UTF-8 contents, binary images and valid CRCs', async () => {
  const files = [{ path: 'src/seed.json', data: '{"title":"Пример"}\n' }, { path: 'public/assets/image.png', data: new Uint8Array([0, 255, 1, 2, 3]) }];
  const buffer = Buffer.from(await zip(files).arrayBuffer());
  let offset = 0;
  for (const file of files) {
    assert.equal(buffer.readUInt32LE(offset), 0x04034b50);
    const length = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    assert.equal(buffer.subarray(offset + 30, offset + 30 + nameLength).toString(), file.path);
    const data = buffer.subarray(offset + 30 + nameLength, offset + 30 + nameLength + length);
    assert.deepEqual(data, Buffer.from(file.data));
    assert.equal(buffer.readUInt32LE(offset + 14), crc32(data));
    offset += 30 + nameLength + length;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50);
  assert.equal(buffer.readUInt16LE(buffer.length - 12), files.length);
});
