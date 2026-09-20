/**
 * 檢查內容裡引用的圖片與文件是否都真的存在。
 *
 * 會加這支檢查，是因為曾有一張內嵌在產品說明裡的圖片指向舊站的 /data/data1/，
 * 那個目錄當初沒有一併搬過來，網站上顯示為破圖，卻沒有任何地方會報錯，
 * 直到瀏覽器測試記錄到 404 才被發現。
 *
 * 用法：node scripts/check-assets.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

const products = JSON.parse(readFileSync(join(ROOT, 'content', 'products.json'), 'utf8'));

const missing = [];
let checked = 0;

/** 只檢查指向本站的絕對路徑；外部網址與 data: 不在檢查範圍 */
function verify(path, where) {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return;
  checked++;
  if (!existsSync(join(PUBLIC, path.split('?')[0]))) missing.push(`${where}　→　${path}`);
}

for (const product of products) {
  for (const image of product.images ?? []) verify(image, `${product.name}（產品照）`);
  for (const doc of product.documents ?? []) verify(doc.file, `${product.name}（文件「${doc.label}」）`);
  for (const match of (product.spec_html ?? '').matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    verify(match[1], `${product.name}（說明內嵌圖）`);
  }
  for (const match of (product.spec_html ?? '').matchAll(/<a[^>]+href=["'](\/[^"']+)["']/gi)) {
    if (/\.(pdf|jpe?g|png|gif|webp|zip|docx?|xlsx?)$/i.test(match[1])) {
      verify(match[1], `${product.name}（說明內連結）`);
    }
  }
}

console.log(`檢查了 ${checked} 個檔案引用`);
if (missing.length) {
  console.error(`\n❌ 有 ${missing.length} 個引用的檔案不存在：`);
  for (const item of missing) console.error(`   ${item}`);
  console.error('\n上傳缺少的檔案，或在後台移除該引用。');
  process.exit(1);
}
console.log('✅ 所有引用的檔案都存在');
