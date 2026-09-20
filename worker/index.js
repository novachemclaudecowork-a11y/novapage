// Cloudflare **Workers** 專案的進入點（搭配 Workers Static Assets）。
//
// wrangler.jsonc 設了 run_worker_first，因此每個請求都會先進到這裡：
//   1. /admin 開頭 —— 後台，必須通過 Cloudflare Access 身分驗證
//   2. 舊站網址   —— 轉址到新頁面
//   3. 其餘       —— 交給 dist/ 的靜態檔案
//
// Pages 專案不需要這個檔案，它走的是 functions/_middleware.js。
import { legacyRedirectResponse } from '../src/lib/legacy-redirects.mjs';
import { authenticate, handleAdminApi } from './api.js';

// 診斷用。回 ok 表示 Worker 確實在執行；回 404 表示部署的版本沒帶到 Worker。
const CHECK_PATH = '/__worker-check';

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

    // 登入頁本身不需要登入，否則沒人進得去
    const isLoginPage =
      url.pathname === '/admin/login' || url.pathname === '/admin/login/';

    // 後台介面本身也要驗證。
    // 不能只靠 Cloudflare Access 擋在前面：workers.dev 網址、
    // 設定變更或路由未涵蓋的情況都可能讓請求直接打到這裡。
    if (!isLoginPage && (url.pathname === '/admin' || url.pathname.startsWith('/admin/'))) {
      if (!(await authenticate(request, env))) {
        // 導向登入頁，而不是丟一個死路的錯誤畫面
        return Response.redirect(new URL('/admin/login/', url.origin).href, 302);
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
