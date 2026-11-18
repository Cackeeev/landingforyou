import { readContent, db, root } from '../src/store.mjs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const content = readContent();
const sections = content.sections.filter(item => item.status === 'published');
const projects = sections.some(item => item.type === 'projects') ? content.projects.filter(item => item.status === 'published') : [];
const services = sections.some(item => item.type === 'services') ? content.services.filter(item => item.status === 'published') : [];
const settings = content.settings;
const exported = new Map();
function exportImage(path) {
  if (!path.startsWith('/media/')) return path;
  if (exported.has(path)) return exported.get(path);
  const media = db.prepare('SELECT * FROM media WHERE id=?').get(path.slice(7));
  if (!media) throw new Error('Image is missing: ' + path);
  const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  const name = 'image-' + media.id + '.' + extensions[media.mime];
  writeFileSync(resolve(root, 'public/assets', name), media.bytes);
  const url = '/assets/' + name;
  exported.set(path, url);
  return url;
}
settings.logo = exportImage(settings.logo);
for (const project of projects) {
  project.image = exportImage(project.image);
  project.gallery = project.gallery.map(item => ({ ...item, image: exportImage(item.image) }));
}
for (const section of sections) {
  section.image = exportImage(section.image);
  section.images = section.images.map(item => ({ ...item, image: exportImage(item.image) }));
}
writeFileSync(resolve(root, 'src/seed.json'), JSON.stringify({
  settings, projects, services, sections,
  navigation: content.navigation.filter(item => item.status === 'published')
}, null, 2) + '\n');
db.close();
console.log('Published content exported. Drafts, requests and credentials excluded.');
