// Cloudflare **Pages** 專案的轉接層。
//
// Pages 會自動載入 functions/ 底下的檔案；Workers 專案則不會，
// 那種情況走的是 worker/index.js。兩者共用同一套判斷邏輯。
import { legacyRedirectResponse } from '../src/lib/legacy-redirects.mjs';

export async function onRequest(context) {
  return legacyRedirectResponse(context.request) ?? context.next();
}
