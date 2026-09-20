/**
 * 清掉產品說明裡舊站編輯器留下的無用標記。
 *
 * 舊站的 HTML 每一行都包著 <span style="font-size: 12pt;">，
 * 這些字級早已被網站 CSS 覆蓋，畫面上毫無作用，卻讓後台的說明欄位
 * 看起來像一堆程式碼，非技術同仁不敢編輯。
 *
 * 只移除單純承載字級的 span，其餘標記（strong、p、br 等）一律保留。
 * 執行後會比對清理前後的純文字，若有任何一項文字內容改變就中止，
 * 確保只動到標記、不動到內容。
 *
 * 預設只預覽，加 --apply 才寫入。
 *   node scripts/clean-spec-html.mjs
 *   node scripts/clean-spec-html.mjs --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'content', 'products.json');

/** 只帶 font-size 的 span，把外層拆掉、內容留下 */
const FONT_SPAN = /<span\s+style="\s*font-size:\s*[^";]*;?\s*"\s*>([\s\S]*?)<\/span>/gi;

function clean(html) {
  let out = html;
  // 巢狀時需重複處理，直到沒有可拆的為止
  for (let i = 0; i < 5; i++) {
    const next = out.replace(FONT_SPAN, '$1');
    if (next === out) break;
    out = next;
  }
  return out
    .replace(/<p>\s*<\/p>/gi, '')       // 清掉空段落
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * 取出純文字，用來確認清理沒有改到內容。
 *
 * 只把區塊標籤視為斷字，行內標籤（span、strong 等）直接去掉不留空白——
 * 這才符合瀏覽器實際的呈現：`：</span><span>在` 畫面上是「：在」而非「： 在」。
 * 若一律以空白取代，移除 span 會被誤判為內容改變。
 */
const BLOCK_TAGS = /<\/?(?:p|div|li|ul|ol|br|pre|table|tr|td|th|h[1-6]|section|blockquote)\b[^>]*>/gi;
const plain = (html) =>
  html
    .replace(BLOCK_TAGS, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const apply = process.argv.includes('--apply');
const products = JSON.parse(readFileSync(FILE, 'utf8'));

let changed = 0;
let bytesBefore = 0;
let bytesAfter = 0;
const mismatches = [];

for (const product of products) {
  const before = product.spec_html ?? '';
  if (!before) continue;
  const after = clean(before);
  bytesBefore += before.length;
  bytesAfter += after.length;
  if (before === after) continue;

  if (plain(before) !== plain(after)) {
    mismatches.push(product.name);
    continue;
  }
  changed++;
  if (apply) product.spec_html = after;
}

if (mismatches.length) {
  console.error('❌ 下列產品清理後文字內容不一致，已中止，未做任何修改：');
  for (const name of mismatches) console.error(`   ・${name}`);
  process.exit(1);
}

console.log(`可清理的產品：${changed} / ${products.length}`);
console.log(`說明總長度：${bytesBefore.toLocaleString()} → ${bytesAfter.toLocaleString()} 字元` +
  `（少 ${Math.round((1 - bytesAfter / bytesBefore) * 100)}%）`);
console.log('✅ 所有產品的純文字內容比對一致，只動到標記');

if (apply) {
  writeFileSync(FILE, JSON.stringify(products, null, 2) + '\n', 'utf8');
  console.log(`\n已寫回 content/products.json`);
} else {
  const sample = products.find((p) => p.spec_html && clean(p.spec_html) !== p.spec_html);
  if (sample) {
    console.log(`\n範例（${sample.name}）：`);
    console.log('  原：' + sample.spec_html.split('\n')[0].slice(0, 110));
    console.log('  改：' + clean(sample.spec_html).split('\n')[0].slice(0, 110));
  }
  console.log('\n以上為預覽。確認無誤後執行：node scripts/clean-spec-html.mjs --apply');
}
