/**
 * 驗證舊網址轉址。
 *
 * 取鏡像中實際存在的每一個舊網址，跑過 functions/_middleware.js 的
 * resolveLegacy()，再確認導向的目標頁面真的存在於 dist/ 之中。
 *
 * 用法：node scripts/test_redirects.mjs   （需先 npm run build）
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolveLegacy } from '../src/lib/legacy-redirects.mjs';

const legacy = JSON.parse(readFileSync('content/legacy/legacy-urls.json', 'utf8'));
// 以 content/ 為準。src/data/catalog.json 是當初匯入的產物，
// 內容早已過時（例如仍含已停售的品項），不可拿來當測試基準。
const products = JSON.parse(readFileSync('content/products.json', 'utf8'));
// 經貴公司確認的錯字修正，比對時要視為同一項產品
const corrections = JSON.parse(readFileSync('content/legacy/name-corrections.json', 'utf8'));
const correct = (name) => corrections[name] ?? name;

const nameBySlug = new Map(
  products.filter((p) => p.published).map((p) => [`/products/${p.slug}/`, p.name]),
);

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

// 另外測選單、分類，以及 Google 實際收錄的子分類網址。
//
// 後面那批帶 m2 的網址**不在鏡像裡**（鏡像只抓到 m2=159 一組），
// 但它們是搜尋結果上實際存在的連結，也就是轉址最需要照顧的對象。
// 曾因帶 m2 時誤用主分類的 pg 去查，全部導到不相干的產品，故納入測試。
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

  // 以下取自 Google 搜尋結果中實際出現的舊網址
  ['/view.asp?id=132&m=2&m2=142&pd_type=142&pdid=sub2&pg=1', '/products/bs-thinner/'],
  ['/view.html?id=133&m=2&m2=143&pd_type=143&pdid=sub2&pg=1', '/products/sw-cleaner/'],
  ['/view.html?id=127&m=1&m2=136&pd_type=136&pdid=sub2&pg=1', '/products/cw-waterbased/'],
  ['/view.html?id=120&m=1&m2=129&pd_type=129&pdid=sub2&pg=1', '/products/mpv/'],
  ['/view.asp?id=156&m=4&m2=150&pd_type=150&pdid=sub2&pg=1', '/products/emulsion/'],
  ['/view.asp?id=126&m=1&m2=135&pd_type=135&pdid=sub2&pg=1', '/products/pu-elastic/'],
  ['/view.html?id=121&m=1&m2=130&pd_type=130&pdid=sub2&pg=1', '/products/pet-label/'],
  // 空白產品線：沒有產品可導，應落在產品線頁而非亂導
  ['/view.html?id=1&m=1&m2=141&pd_type=141&pdid=sub2&pg=1', '/category/screen-inks/metallic-glitter/'],
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
