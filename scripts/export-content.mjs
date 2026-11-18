import { readContent, db, root } from '../src/store.mjs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { settings, projects, services } = readContent();
const publishedProjects = projects.filter(item => item.status === 'published');
for (const project of publishedProjects) {
  if (!project.image.startsWith('/media/')) continue;
  const media = db.prepare('SELECT * FROM media WHERE id=?').get(project.image.slice(7));
  if (!media) throw new Error('Project image is missing: ' + project.id);
  const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  const name = 'project-' + media.id + '.' + extensions[media.mime];
  writeFileSync(resolve(root, 'public/assets', name), media.bytes);
  project.image = '/assets/' + name;
}
writeFileSync(resolve(root, 'src/seed.json'), JSON.stringify({
  settings, projects: publishedProjects, services: services.filter(item => item.status === 'published')
}, null, 2) + '\n');
db.close();
console.log('Published content exported. Drafts, requests and credentials excluded.');
