export const defaultSettings = {
  siteTitle: 'Александр — веб-разработка и сопровождение', brandName: 'Landingforyou',
  logo: '/assets/wordmark.webp', accent: '#0d33ed', paper: '#f1f1f0', showStickers: true,
  heroCtaLabel: 'Смотреть работы', heroCtaUrl: '#work', contactLabel: 'Связаться',
  contactLinkLabel: 'Написать мне', contactDialogTitle: 'Расскажите о задаче',
  contactActionLabel: 'Описать задачу', contactMode: 'dialog', showRequestForm: true,
  requestIntro: 'Или оставьте заявку на сайте', requestNameLabel: 'Имя',
  requestContactLabel: 'Контакт', requestTaskLabel: 'Задача', requestSubmitLabel: 'Отправить заявку',
  footerText: 'Александр.', adminLabel: 'Войти в админку'
};

export const projectThemes = { mint: 'Мятная', light: 'Светлая', dark: 'Тёмная', blue: 'Синяя', custom: 'Свои цвета', image: 'Фоновое изображение' };

export const defaultSections = [
  { id: 'work', type: 'projects', title: 'Работы', description: '', status: 'published' },
  { id: 'services', type: 'services', title: 'Услуги', description: '', status: 'published' },
  { id: 'process', type: 'about', title: 'Обо мне', description: '', status: 'published' },
  { id: 'contact', type: 'contact', title: 'Обсудим проект?', description: 'Расскажите, что хотите создать или доработать.', status: 'published' }
];

export const defaultNavigation = [
  { id: 'about-link', label: 'Обо мне', url: '#process', status: 'published' },
  { id: 'work-link', label: 'Работы', url: '#work', status: 'published' },
  { id: 'services-link', label: 'Услуги', url: '#services', status: 'published' }
];

// Fill only missing fields so existing databases keep their content and order.
export function normalizeContent(content) {
  const settings = { ...defaultSettings, ...content.settings };
  settings.contactUrl ??= 'https://t.me/' + settings.telegram;
  return {
    ...content, settings,
    projects: content.projects.map(project => ({ gallery: [], linkLabel: 'Открыть проект', cardTheme: 'mint', cardColor: '#d8eddf', cardText: '#173d37', backgroundImage: '', ...project })),
    services: content.services.map(service => ({ url: '', linkLabel: '', ...service })),
    sections: (content.sections ?? defaultSections).map(section => ({ description: '', body: '', image: '', images: [], url: '', linkLabel: '', ...section })),
    navigation: structuredClone(content.navigation ?? defaultNavigation)
  };
}

export function imagePaths(content) {
  return [content.settings.logo,
    ...content.projects.flatMap(project => [project.image, project.backgroundImage, ...project.gallery.map(item => item.image)]),
    ...content.sections.flatMap(section => [section.image, ...section.images.map(item => item.image)])
  ].filter(Boolean);
}

export function themeCss(settings, projects = []) {
  const color = (value, fallback) => /^#[a-fA-F0-9]{6}$/.test(value) ? value : fallback;
  const cards = projects.filter(project => ['custom', 'image'].includes(project.cardTheme) && /^[a-zA-Z0-9-]+$/.test(project.id)).map(project => `.project-preview[data-project="${project.id}"] { --project-background: ${color(project.cardColor, '#d8eddf')}; --project-text: ${color(project.cardText, project.cardTheme === 'image' ? '#ffffff' : '#173d37')}; }`).join('\n');
  return `:root { --blue: ${color(settings.accent, defaultSettings.accent)}; --paper: ${color(settings.paper, defaultSettings.paper)}; --poster-paper: ${color(settings.paper, defaultSettings.paper)}; }\n${cards}\n`;
}
