/**
 * 後台介面的操作測試。
 *
 * 用真實瀏覽器開啟後台，攔截 /admin/api/* 改由本程式回應，
 * 藉此在不碰到正式資料的情況下，驗證介面的行為與它送出的內容是否正確。
 *
 * 用法：
 *   npm run build && npx astro preview --port 4330 &
 *   node scripts/test_admin_ui.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.ADMIN_TEST_BASE ?? 'http://127.0.0.1:4330';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const fixture = () => ({
  products: [
    {
      slug: 'cw-waterbased', name: 'CW水性油墨', code: '08',
      category: 'screen-inks', subcategory: 'cw-waterbased',
      published: true, order: 60, images: ['/images/products/1/127-1b.jpg'],
      documents: [], spec_html: '<p>測試說明</p>', legacy: { m: '1', pg: 6 },
    },
    {
      slug: 'bs-thinner', name: '油墨專用稀釋劑', code: 'BS 稀釋劑系列',
      category: 'thinners-cleaners', subcategory: 'bs-thinner',
      published: true, order: 20, images: [], documents: [],
      spec_html: '<p>稀釋劑說明</p>', legacy: { m: '2', pg: 2 },
    },
  ],
  categories: [
    {
      slug: 'screen-inks', name: '網印油墨', order: 10, published: true, legacy_m: '1',
      children: [
        { slug: 'cw-waterbased', name: 'CW水性油墨', order: 10, published: true, legacy_m2: '136' },
        { slug: 'mpv', name: 'MPV通用油墨', order: 20, published: true, legacy_m2: '129' },
      ],
    },
    {
      slug: 'thinners-cleaners', name: '稀釋劑&洗版劑', order: 20, published: true, legacy_m: '2',
      children: [
        { slug: 'bs-thinner', name: 'BS 稀釋劑', order: 10, published: true, legacy_m2: '142' },
      ],
    },
  ],
  news: [],
  about: { title: '公司簡介', body: '貝星公司\n成立於1988年。' },
  sha: { products: 'sha-p', categories: 'sha-c', news: 'sha-n', about: 'sha-a' },
});

const saved = [];
const uploads = [];
let pass = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log(`  ✅ ${label}`); pass++; }
  else { failures.push(`${label}\n       預期 ${JSON.stringify(expected)}\n       實際 ${JSON.stringify(actual)}`); console.log(`  ❌ ${label}`); }
}

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(e.message));
// 記下實際失敗的網址，才知道 404 是哪個資源。
// 模擬上傳回傳的路徑在磁碟上並不存在，那是測試本身的產物，不列入。
const MOCK_UPLOAD_PATH = '/images/products/uploaded-test.png';
const failedRequests = [];
page.on('response', (r) => {
  const path = new URL(r.url()).pathname;
  if (r.status() >= 400 && !path.startsWith('/admin/api/') && path !== MOCK_UPLOAD_PATH) {
    failedRequests.push(`${r.status()} ${path}`);
  }
});

await context.route('**/admin/api/**', async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname.replace('/admin/api/', '');
  const method = request.method();

  if (path === 'content' && method === 'GET') {
    return route.fulfill({ json: fixture() });
  }
  if (path === 'upload' && method === 'POST') {
    uploads.push(request.postData()?.length ?? 0);
    return route.fulfill({ json: { path: '/images/products/uploaded-test.png', name: 'uploaded-test.png' } });
  }
  if (method === 'PUT') {
    saved.push({ section: path, body: JSON.parse(request.postData() ?? '{}') });
    return route.fulfill({ json: { ok: true } });
  }
  return route.fulfill({ json: { ok: true } });
});

await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });

console.log('載入與列表：');
await page.waitForSelector('table tbody tr');
check('列出兩項產品', await page.locator('table tbody tr').count(), 2);
check('依排序顯示，稀釋劑在前', (await page.locator('tbody tr td.name').first().textContent()), '油墨專用稀釋劑');
check('儲存鈕初始為停用', await page.locator('#save').isDisabled(), true);

console.log('\n搜尋：');
await page.fill('input[type="search"]', '水性');
await page.waitForTimeout(150);
check('搜尋後只剩一列', await page.locator('table tbody tr').count(), 1);
await page.fill('input[type="search"]', '');
await page.waitForTimeout(150);

console.log('\n上下架切換：');
await page.locator('tbody tr', { hasText: 'CW水性油墨' }).locator('button.pill').click();
check('狀態變為已下架', (await page.locator('tbody tr', { hasText: 'CW水性油墨' }).locator('button.pill').textContent()), '已下架');
check('儲存鈕變為可按', await page.locator('#save').isDisabled(), false);

console.log('\n編輯產品：');
await page.locator('tbody tr', { hasText: 'CW水性油墨' }).getByRole('button', { name: '編輯' }).click();
await page.waitForSelector('#f-name');
check('帶入現有名稱', await page.inputValue('#f-name'), 'CW水性油墨');
check('帶入現有分類', await page.inputValue('#f-cat'), 'screen-inks');
check('產品線選項跟著主分類', await page.locator('#f-sub option').count(), 3);

await page.fill('#f-name', 'CW水性油墨（改）');
await page.fill('#f-code', 'CW-08');
await page.selectOption('#f-cat', 'thinners-cleaners');
await page.waitForTimeout(100);
check('換主分類後產品線重新載入', await page.locator('#f-sub option').count(), 2);

console.log('\n照片：');
check('顯示既有照片一張', await page.locator('.thumb').count(), 1);
await page.locator('.thumb button').click();
check('移除後歸零', await page.locator('.thumb').count(), 0);
await page.setInputFiles('#f-image', {
  name: 'test.png', mimeType: 'image/png',
  buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
});
await page.waitForTimeout(400);
check('上傳後加回一張', await page.locator('.thumb').count(), 1);
check('確實呼叫了上傳端點', uploads.length > 0, true);

console.log('\n儲存：');
await page.locator('#save').click();
await page.waitForTimeout(600);
check('送出一次儲存', saved.length >= 1, true);
const payload = saved.find((s) => s.section === 'products');
check('送出的是產品資料', Boolean(payload), true);
check('帶上 sha 供衝突偵測', payload?.body.sha, 'sha-p');
const edited = payload?.body.value.find((p) => p.slug === 'cw-waterbased');
check('名稱已更新', edited?.name, 'CW水性油墨（改）');
check('編號已更新', edited?.code, 'CW-08');
check('分類已更新', edited?.category, 'thinners-cleaners');
check('下架狀態已保存', edited?.published, false);
check('照片為新上傳的', edited?.images, ['/images/products/uploaded-test.png']);
check('轉址所需的 legacy 欄位未遺失', edited?.legacy, { m: '1', pg: 6 });

console.log('\n新增產品：');
await page.locator('button', { hasText: '完成編輯' }).click();
await page.waitForSelector('table tbody tr');
page.once('dialog', (d) => d.accept('矽膠油墨測試'));
await page.locator('button', { hasText: '新增產品' }).click();
await page.waitForSelector('#f-name');
check('新產品帶入輸入的名稱', await page.inputValue('#f-name'), '矽膠油墨測試');
check('新產品預設不上架', await page.isChecked('#f-pub'), false);

console.log('\n分頁切換：');
await page.locator('button[data-tab="about"]').click();
await page.waitForSelector('#a-body');
check('公司簡介載入既有內容', (await page.inputValue('#a-body')).includes('成立於1988年'), true);
await page.locator('button[data-tab="news"]').click();
await page.waitForSelector('button:has-text("發布新訊息")');
check('最新訊息顯示空狀態', (await page.locator('.empty').textContent()).includes('沒有訊息'), true);

console.log(`\n資源載入失敗：${failedRequests.length === 0 ? '無' : failedRequests.join(' | ')}`);
if (failedRequests.length) failures.push(`有資源載入失敗：${failedRequests.join(' | ')}`);
else pass++;

await browser.close();

console.log(`\n${failures.length ? '❌' : '✅'} 通過 ${pass} 項${failures.length ? `，失敗 ${failures.length} 項` : '，全數符合預期'}`);
for (const f of failures) console.log('   ' + f);
process.exit(failures.length ? 1 : 0);
