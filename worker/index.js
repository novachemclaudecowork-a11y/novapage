// Cloudflare **Workers** 專案的進入點（搭配 Workers Static Assets）。
//
// wrangler.jsonc 設了 run_worker_first，因此每個請求都會先進到這裡：
//   1. /admin 開頭 —— 後台，必須通過 Cloudflare Access 身分驗證
//   2. 舊站網址   —— 轉址到新頁面
//   3. 其餘       —— 交給 dist/ 的靜態檔案
//
// Pages 專案不需要這個檔案，它走的是 functions/_middleware.js。
import { legacyRedirectResponse } from '../src/lib/legacy-redirects.mjs';
import { verifyAccessJwt } from './access.js';
import { handleAdminApi } from './api.js';

// 診斷用。回 ok 表示 Worker 確實在執行；回 404 表示部署的版本沒帶到 Worker。
const CHECK_PATH = '/__worker-check';

const DENIED_HTML = `<!doctype html>
<html lang="zh-Hant-TW"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>無法存取後台</title>
<style>
  body{font-family:system-ui,"Noto Sans TC",sans-serif;line-height:1.8;
       max-width:34rem;margin:12vh auto;padding:0 16px;color:#1c2027}
  h1{font-size:1.25rem}code{background:#f5f7fa;padding:2px 6px;border-radius:4px}
</style></head>
<body>
  <h1>無法存取後台</h1>
  <p>你的登入身分無法驗證，因此後台不會開啟。</p>
  <p>若你是公司同仁，請確認是以公司 Email 登入；
     若這個網站尚未完成 <code>Cloudflare Access</code> 設定，請先完成設定再使用後台。</p>
  <p><a href="/">回首頁</a></p>
</body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === CHECK_PATH) {
      return new Response('ok\n', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    if (url.pathname.startsWith('/admin/api')) {
      return handleAdminApi(request, env);
    }

    // 後台介面本身也要驗證。
    // 不能只靠 Cloudflare Access 擋在前面：workers.dev 網址、
    // 設定變更或路由未涵蓋的情況都可能讓請求直接打到這裡。
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      try {
        await verifyAccessJwt(request, env);
      } catch {
        return new Response(DENIED_HTML, {
          status: 403,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
      const res = await env.ASSETS.fetch(request);
      // 後台頁面不快取，避免登出後仍從快取取得內容
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'no-store');
      return new Response(res.body, { status: res.status, headers });
    }

    return legacyRedirectResponse(request) ?? env.ASSETS.fetch(request);
  },
};
