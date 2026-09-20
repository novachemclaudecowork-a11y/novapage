/**
 * 把 cards.html 裡的每張設計稿輸出為 PNG。
 *
 * 產出的圖片放在 design/product-images/，**不在 public/ 底下**，
 * 因此不會被放上網站。要使用時再從後台上傳。
 *
 * 用法：npm run design
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'product-images');

// 每張設計稿的 HTML id 對應到輸出的檔名
const CARDS = {
  'pu-app': 'pu-elastic-應用圖',
  'pu-spec': 'pu-elastic-規格圖',
  'pd-app': 'pd-metal-glass-應用圖',
  'pd-spec': 'pd-metal-glass-規格圖',
};

// 設計稿為 1200×900，以 1.5 倍輸出成 1800×1350，
// 在高解析螢幕上不會糊，檔案又不至於過大
const SCALE = 1.5;

// 這個環境的 Chromium 位置；其他電腦上讓 Playwright 自行尋找
const LOCAL_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(
  existsSync(LOCAL_CHROME) ? { executablePath: LOCAL_CHROME } : {},
);
const page = await browser.newPage({
  viewport: { width: 1400, height: 1000 },
  deviceScaleFactor: SCALE,
});

await page.goto('file://' + join(HERE, 'cards.html'), { waitUntil: 'networkidle' });
// 等字型載入完成，否則會拍到還沒套用字型的畫面
await page.waitForTimeout(800);

for (const [id, name] of Object.entries(CARDS)) {
  const target = page.locator('#' + id);
  if (!(await target.count())) {
    console.warn(`⚠️  找不到 #${id}，略過`);
    continue;
  }
  await target.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`✅ ${name}.png`);
}

await browser.close();
console.log(`\n輸出於 design/product-images/（不會出現在網站上）`);
