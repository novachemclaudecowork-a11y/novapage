/**
 * 站內搜尋的瀏覽器操作測試。
 *
 * 比對邏輯本身由 scripts/test_search.mjs 驗證，這裡測的是使用者實際的操作路徑：
 * 從頁首搜尋、網址帶關鍵字、邊打字邊出結果、查無結果、點進產品頁。
 *
 * 用法：npm run build && node scripts/test_search_ui.mjs
 * （測試會自己把 dist/ 端起來，不必另外開伺服器）
 */
import { chromium } from 'playwright';
import { startStaticServer } from './lib/static-server.mjs';

// 指定 SEARCH_TEST_BASE 就改測那個網址（例如已部署的測試站），否則自己端 dist/
const server = process.env.SEARCH_TEST_BASE ? null : await startStaticServer();
const BASE = process.env.SEARCH_TEST_BASE ?? server.base;
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const failures = [];
let pass = 0;
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? `　${extra}` : ''}`);
  if (ok) pass++;
  else failures.push(label);
};

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`${r.status()} ${new URL(r.url()).pathname}`);
});

console.log('從頁首搜尋：');
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.fill('#site-search', '尼龍布');
await page.press('#site-search', 'Enter');
await page.waitForURL(/\/search\/\?q=/);
await page.waitForSelector('.results li');
check('導到搜尋頁並帶上關鍵字', true);
check('有搜尋結果', (await page.locator('.results li').count()) > 0);
check('命中的關鍵字有標示', (await page.locator('.results mark').count()) > 0);

console.log('\n網址直接帶關鍵字：');
await page.goto(`${BASE}/search/?q=EM-507`, { waitUntil: 'networkidle' });
await page.waitForSelector('.results li');
const href = await page.locator('.results a').first().getAttribute('href');
check('型號搜尋結果正確', href === '/products/ghost-remover/', href ?? '');

console.log('\n即時搜尋：');
await page.fill('#q', '刮刮樂');
await page.waitForTimeout(500);
check('邊打字邊出結果', (await page.locator('.results li').count()) > 0);
check('網址同步更新', decodeURIComponent(page.url()).includes('刮刮樂'));

console.log('\n查無結果：');
await page.fill('#q', 'zzz不存在的東西zzz');
await page.waitForTimeout(500);
const summary = (await page.locator('#summary').textContent()) ?? '';
check('提示找不到並附上電話', summary.includes('找不到') && summary.includes('2299-4000'), summary.slice(0, 40));

console.log('\n點進產品頁：');
await page.fill('#q', '感光乳劑');
await page.waitForTimeout(500);
await page.locator('.results a').first().click();
await page.waitForURL(/\/products\//);
check('可進入對應的產品頁', page.url().includes('/products/emulsion/'), page.url().replace(BASE, ''));

console.log('\n手機版：');
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mPage = await mobile.newPage();
await mPage.goto(`${BASE}/search/?q=洗版劑`, { waitUntil: 'networkidle' });
await mPage.waitForSelector('.results li');
check('有搜尋結果', (await mPage.locator('.results li').count()) > 0);
check('無水平捲動', !(await mPage.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 1,
)));

await browser.close();
await server?.stop();

console.log(`\n資源與 console：${problems.length ? problems.join(' | ') : '無問題'}`);
if (problems.length) failures.push(`有資源或 console 問題：${problems.join(' | ')}`);
else pass++;

console.log(`\n${failures.length ? '❌' : '✅'} 通過 ${pass} 項${failures.length ? `，失敗 ${failures.length} 項` : '，全數符合預期'}`);
for (const f of failures) console.log('   ' + f);
process.exit(failures.length ? 1 : 0);
