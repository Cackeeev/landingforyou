import { normalizeContent } from './content.mjs';

export function publishedContent(raw, image = path => path) {
  const content = normalizeContent(structuredClone(raw));
  content.sections = content.sections.filter(row => row.status === 'published');
  content.projects = content.sections.some(row => row.type === 'projects') ? content.projects.filter(row => row.status === 'published') : [];
  content.services = content.sections.some(row => row.type === 'services') ? content.services.filter(row => row.status === 'published') : [];
  content.navigation = content.navigation.filter(row => row.status === 'published');
  content.settings.logo = image(content.settings.logo);
  for (const project of content.projects) {
    project.image = image(project.image); project.backgroundImage = image(project.backgroundImage);
    project.gallery.forEach(item => { item.image = image(item.image); });
  }
  for (const section of content.sections) {
    section.image = image(section.image); section.images.forEach(item => { item.image = image(item.image); });
  }
  return { settings: content.settings, projects: content.projects, services: content.services, sections: content.sections, navigation: content.navigation };
}

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
