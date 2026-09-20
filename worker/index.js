// Cloudflare **Workers** 專案的進入點（使用 Workers Static Assets）。
//
// Pages 專案不需要這個檔案，它走的是 functions/_middleware.js。
// 兩者共用 src/lib/legacy-redirects.mjs 的判斷邏輯，行為一致。
//
// 先比對舊網址；沒有對應時才把請求交給靜態資源。
import { legacyRedirectResponse } from '../src/lib/legacy-redirects.mjs';

export default {
  async fetch(request, env) {
    return legacyRedirectResponse(request) ?? env.ASSETS.fetch(request);
  },
};
