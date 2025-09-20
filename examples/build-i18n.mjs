import { buildI18n } from '../dist/build-i18n/index.mjs';

buildI18n({
  group: 'is_website',
  projects: [145],
  outDir: 'examples/locales',
});
