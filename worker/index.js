// Cloudflare **Workers** 專案的進入點（搭配 Workers Static Assets）。
//
// Pages 專案不需要這個檔案，它走的是 functions/_middleware.js。
// 兩者共用 src/lib/legacy-redirects.mjs 的判斷邏輯，行為一致。
//
// wrangler.jsonc 設了 run_worker_first，因此每個請求都會先進到這裡：
// 先比對舊網址，沒有對應時才把請求交給靜態資源。
import { legacyRedirectResponse } from '../src/lib/legacy-redirects.mjs';

// 診斷用。部署後打開 /__worker-check，若回 ok 表示 Worker 確實在執行；
// 若回 404 表示部署的版本沒有帶到 Worker，轉址自然不會生效。
const CHECK_PATH = '/__worker-check';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === CHECK_PATH) {
      return new Response('ok\n', {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    return legacyRedirectResponse(request) ?? env.ASSETS.fetch(request);
  },
};
