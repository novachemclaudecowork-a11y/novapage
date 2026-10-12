/**
 * 產品分類側欄的測試。
 *
 * 側欄是分類頁與產品頁唯一的導覽，壞掉就等於找不到產品。
 * 這裡測的是建置產物：圖示、產品數、以及釘住捲動的行為。
 *
 * 用法：npm run build && node scripts/test_catnav.mjs
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startStaticServer } from './lib/static-server.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const categories = JSON.parse(readFileSync('content/categories.json', 'utf8'));
const products = JSON.parse(readFileSync('content/products.json', 'utf8'));

let pass = 0;
const failures = [];
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log(`  ✅ ${label}`); pass++; }
  else {
    failures.push(`${label}\n       預期 ${JSON.stringify(expected)}\n       實際 ${JSON.stringify(actual)}`);
    console.log(`  ❌ ${label}`);
  }
}

const published = categories.filter((c) => c.published !== false);
const countOf = (slug) =>
  products.filter((p) => p.published && p.category === slug).length;

const server = await startStaticServer();
const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

try {
  await page.goto(`${server.base}/category/platemaking/`, { waitUntil: 'networkidle' });

  console.log('圖示：');
  check('每個大分類都有圖示', await page.locator('.cat-main .cat-icon').count(), published.length);
  // 內嵌 SVG 才不會多一次請求，也才能跟著文字顏色走
  check('是內嵌 SVG 而非圖片檔',
    await page.locator('.cat-main .cat-icon').first().evaluate((n) => n.tagName.toLowerCase()), 'svg');
  check('顏色跟著文字走',
    await page.locator('.cat-main .cat-icon').first().evaluate((n) => n.getAttribute('stroke')), 'currentColor');
  // 圖示純裝飾，讀螢幕軟體不該把它念出來
  check('對讀螢幕軟體隱藏',
    await page.locator('.cat-main .cat-icon').first().getAttribute('aria-hidden'), 'true');

  console.log('\n產品數：');
  check('每個大分類都標了數量', await page.locator('.cat-count').count(), published.length);
  check('數字與實際上架數相符',
    await page.locator('.cat-count').allTextContents(),
    published.map((c) => String(countOf(c.slug))));

  console.log('\n只展開目前所在的大分類：');
  const activeChildren = published.find((c) => c.slug === 'platemaking')
    ?.children.filter((x) => x.published !== false).length;
  check('只有一個大分類是展開的', await page.locator('.cat-nav > ul > li.open').count(), 1);
  check('展開的是目前所在的分類',
    await page.locator('.cat-nav > ul > li.open .cat-main').first().getAttribute('href'),
    '/category/platemaking/');
  check('展開的分類列出底下所有產品線',
    await page.locator('.cat-nav > ul > li.open .cat-sub li').count(), activeChildren);
  // 收起來的產品線仍在 HTML 裡（連結才不會斷），但不該被看到
  const collapsed = page.locator('.cat-nav > ul > li:not(.open)').first();
  check('收起來的產品線看不到',
    await collapsed.locator('.cat-sub li a').first().isVisible(), false);
  check('但連結仍在頁面上（不會變成找不到的孤島）',
    (await collapsed.locator('.cat-sub li a').count()) > 0, true);

  console.log('\n沒有指定分類時（產品總覽頁）：');
  const overview = await context.newPage();
  await overview.goto(`${server.base}/products/`, { waitUntil: 'networkidle' });
  check('全部收起來', await overview.locator('.cat-nav > ul > li.open').count(), 0);
  check('四個大分類仍在', await overview.locator('.cat-main').count(), published.length);
  await overview.close();

  console.log('\n展開與收合：');
  const first = page.locator('.cat-nav > ul > li').first();
  const panel = first.locator('.cat-sub');
  const panelHeight = async () => Math.round((await panel.boundingBox()).height);
  check('一開始是收合的（高度為零）', await panelHeight(), 0);
  check('箭頭標示為未展開',
    await first.locator('.cat-toggle').getAttribute('aria-expanded'), 'false');

  await first.locator('.cat-toggle').click();
  await page.waitForTimeout(110);
  const midway = await panelHeight();
  await page.waitForTimeout(500);
  const opened = await panelHeight();
  // 只檢查最終高度的話，瞬間跳開也會通過；要確認中途真的在長高
  check('展開過程中高度逐漸變化', midway > 0 && midway < opened, true);
  check('展開後高度等於內容高度', opened > 100, true);
  check('箭頭改標示為已展開',
    await first.locator('.cat-toggle').getAttribute('aria-expanded'), 'true');
  check('展開後兩個分類同時打開', await page.locator('.cat-nav > ul > li.open').count(), 2);

  await first.locator('.cat-toggle').click();
  await page.waitForTimeout(600);
  check('再按一次收回去', await panelHeight(), 0);
  check('收合後產品線不可見',
    await first.locator('.cat-sub li a').first().isVisible(), false);

  // 分類名稱本身仍是連結，點了要進到該分類頁，不能被箭頭搶走
  await first.locator('.cat-main').click();
  await page.waitForLoadState('networkidle');
  check('點分類名稱會進到該分類頁',
    new URL(page.url()).pathname, `/category/${published[0].slug}/`);
  await page.goto(`${server.base}/category/platemaking/`, { waitUntil: 'networkidle' });

  console.log('\n目前所在位置：');
  check('目前的分類有標記',
    await page.locator('.cat-main[aria-current="true"]').count(), 1);
  check('標在正確的分類上',
    await page.locator('.cat-main[aria-current="true"]').getAttribute('href'), '/category/platemaking/');

  console.log('\n釘住捲動：');
  const navY = async (y) => {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(250);
    return (await page.locator('.cat-nav').boundingBox()).y;
  };
  const top = await navY(0);
  check('未捲動時在標題列下方', top > 100, true);
  // 捲過標題列之後就黏在上緣，看產品時分類仍在手邊。
  // 再往下到頁尾，側欄會隨容器離開畫面——那是 sticky 本來的行為。
  const a = await navY(600);
  const b = await navY(880);
  check('捲動後黏在畫面上緣', a < 20 && a >= 0, true);
  check('持續捲動時停在原處', Math.abs(b - a) < 2, true);

  console.log('\n手機版：');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const mp = await mobile.newPage();
  await mp.goto(`${server.base}/category/screen-inks/`, { waitUntil: 'networkidle' });
  // 窄螢幕放不下，釘住會讓長清單的末端捲不到
  check('窄螢幕不釘住',
    await mp.locator('.cat-nav').evaluate((n) => getComputedStyle(n).position), 'static');
  check('無水平捲動',
    await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  check('圖示在手機版也看得到',
    (await mp.locator('.cat-main .cat-icon').first().boundingBox())?.width > 10, true);
} finally {
  await browser.close();
  await server.stop();
}

console.log(`\n${failures.length ? '❌' : '✅'} 通過 ${pass} 項${failures.length ? `，失敗 ${failures.length} 項` : '，全數符合預期'}`);
for (const f of failures) console.log('   ' + f);
process.exit(failures.length ? 1 : 0);
