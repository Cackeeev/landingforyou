import { readFileSync } from 'node:fs';
import { renderContent } from './public-render.mjs';
export { escape } from './public-render.mjs';
const template = readFileSync(new URL('../templates/site.html', import.meta.url), 'utf8');
export const renderSite = content => renderContent(content, template);
