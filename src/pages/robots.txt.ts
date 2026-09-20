import type { APIRoute } from 'astro';
import { isProduction } from '../data/env';

/*
 * 預設不允許搜尋引擎索引。
 *
 * 上線前的預覽部署若被索引，會與仍在線上的舊站形成重複內容，
 * 導致兩邊的搜尋排名都受影響。因此只有在 Cloudflare Pages 的環境變數
 * 明確設定 SITE_ENV=production 時，才開放索引並提供 sitemap。
 */
export const GET: APIRoute = ({ site }) => {
  const body = isProduction
    ? ['User-agent: *', 'Allow: /', '', `Sitemap: ${new URL('sitemap-index.xml', site).href}`]
    : ['# 預覽部署：禁止索引', 'User-agent: *', 'Disallow: /'];

  return new Response(body.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
