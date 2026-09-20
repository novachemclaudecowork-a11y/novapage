import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/*
 * 網站網址的判定順序：
 *   1. SITE_URL          手動指定時優先
 *   2. CF_PAGES_URL      Cloudflare Pages 自動提供（預覽部署會是 xxx.pages.dev）
 *   3. 正式網域          本機建置時的預設值
 *
 * 這樣預覽部署的 canonical 與 sitemap 會指向預覽網址本身，
 * 而不會指到仍在線上的舊站，避免兩邊被判定為重複內容。
 */
const site = process.env.SITE_URL || process.env.CF_PAGES_URL || 'https://www.novananoinks.com.tw';

export default defineConfig({
  site,
  integrations: [
    // 後台不列入 sitemap，也不該被搜尋引擎發現
    sitemap({ filter: (page) => !page.includes('/admin') }),
  ],
  build: { format: 'directory' },
});
