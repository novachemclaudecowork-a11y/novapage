/**
 * 驗證舊網址轉址。
 *
 * 取鏡像中實際存在的每一個舊網址，跑過 functions/_middleware.js 的
 * resolveLegacy()，再確認導向的目標頁面真的存在於 dist/ 之中。
 *
 * 用法：node scripts/test_redirects.mjs   （需先 npm run build）
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolveLegacy } from '../functions/_middleware.js';

const legacy = JSON.parse(readFileSync('src/data/legacy-urls.json', 'utf8'));
const catalog = JSON.parse(readFileSync('src/data/catalog.json', 'utf8'));
// 經貴公司確認的錯字修正，比對時要視為同一項產品
const corrections = JSON.parse(readFileSync('src/data/name-corrections.json', 'utf8'));
const correct = (name) => corrections[name] ?? name;

const nameBySlug = new Map(catalog.products.map((p) => [`/products/${p.slug}/`, p.name]));

let ok = 0;
const unresolved = [];
const missingPage = [];
const wrongProduct = [];

for (const [oldUrl, info] of Object.entries(legacy)) {
  const url = new URL(oldUrl, 'https://www.novananoinks.com.tw');
  const target = resolveLegacy(url.pathname, url.searchParams);

  if (!target) {
    unresolved.push(oldUrl);
    continue;
  }
  if (!existsSync(`dist${target}index.html`)) {
    missingPage.push(`${oldUrl} → ${target}`);
    continue;
  }
  // 導到產品頁時，該產品必須就是舊網址原本顯示的那一項
  const expected = nameBySlug.get(target);
  if (expected !== undefined && expected !== correct(info.name)) {
    wrongProduct.push(`${oldUrl}\n     舊站顯示「${info.name}」但導向「${expected}」`);
    continue;
  }
  ok++;
}

// 另外測幾個代表性的選單與分類網址
const extra = [
  ['/index.aspx', '/'],
  ['/main.asp', '/products/'],
  ['/page/p.asp?id=1', '/about/'],
  ['/page/p.asp?id=7', '/contact/'],
  ['/page/p.asp?id=9', '/support/'],
  ['/inquiry_list.asp', '/inquiry/'],
  ['/product.html?AB=A&pd_type=1&m=1', '/category/screen-inks/'],
  ['/product.html?AB=A&pd_type=136&pdid=sub2&m=1&m2=136', '/category/screen-inks/cw-waterbased/'],
  ['/view.html?id=999&m=1&pg=6', '/products/cw-waterbased/'],
  ['/view.asp?id=1&m=1', '/category/screen-inks/'],
];
const extraFails = [];
for (const [from, want] of extra) {
  const url = new URL(from, 'https://x.tw');
  const got = resolveLegacy(url.pathname, url.searchParams);
  if (got !== want) extraFails.push(`${from}\n     期望 ${want}，實際 ${got}`);
  else if (!existsSync(`dist${want}index.html`)) extraFails.push(`${from} → ${want} 頁面不存在`);
}

console.log(`鏡像舊網址：${Object.keys(legacy).length} 筆`);
console.log(`  ✅ 正確導向且目標頁存在：${ok}`);
if (unresolved.length) console.log(`  ❌ 無法解析：${unresolved.length}\n     ${unresolved.slice(0, 5).join('\n     ')}`);
if (missingPage.length) console.log(`  ❌ 目標頁不存在：${missingPage.length}\n     ${missingPage.slice(0, 5).join('\n     ')}`);
if (wrongProduct.length) console.log(`  ❌ 導到錯誤的產品：${wrongProduct.length}\n     ${wrongProduct.slice(0, 5).join('\n     ')}`);

console.log(`\n代表性網址：${extra.length} 筆`);
if (extraFails.length) console.log(`  ❌ 失敗 ${extraFails.length}：\n     ${extraFails.join('\n     ')}`);
else console.log('  ✅ 全數正確');

const failed = unresolved.length + missingPage.length + wrongProduct.length + extraFails.length;
console.log(failed === 0 ? '\n✅ 全部通過' : `\n❌ 共 ${failed} 筆失敗`);
process.exit(failed === 0 ? 0 : 1);
