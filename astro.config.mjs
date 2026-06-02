// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // ハブ karatsu-civictech.org/gikai 配下で配信される（Worker が転送）
  site: 'https://karatsu-civictech.org',
  base: '/gikai',
});
