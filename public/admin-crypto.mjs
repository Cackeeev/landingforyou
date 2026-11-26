export const encode = bytes => {
  let result = '';
  for (let i = 0; i < bytes.length; i += 32768) result += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(result);
};
export const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
export async function gitBlobSha(bytes) {
  const header = new TextEncoder().encode('blob ' + bytes.length + '\0');
  const source = new Uint8Array(header.length + bytes.length); source.set(header); source.set(bytes, header.length);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1', source))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function passwordKey(password, salt, iterations = 210000) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: decode(salt), iterations }, material, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
export const importKey = value => crypto.subtle.importKey('raw', decode(value), 'AES-GCM', true, ['encrypt', 'decrypt']);
export const exportKey = async key => encode(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
export async function encrypt(value, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv: encode(iv), data: encode(new Uint8Array(data)) };
}
export async function decrypt(value, key) {
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(value.iv) }, key, decode(value.data));
  return JSON.parse(new TextDecoder().decode(bytes));
}
