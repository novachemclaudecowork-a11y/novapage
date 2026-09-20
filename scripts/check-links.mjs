/**
 * 檢查網站內部連結是否都指向存在的頁面。
 *
 * 會加這支檢查，是因為調整產品線選單時可能不小心連到已不存在的頁面
 * （例如只有一項產品的產品線不再產生列表頁），而這種錯誤不會讓建置失敗，
 * 只有使用者點到才會發現是 404。
 *
 * 用法：npm run build && node scripts/check-links.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

if (!existsSync(DIST)) {
  console.error('找不到 dist/，請先執行 npm run build');
  process.exit(1);
}

/** 走訪 dist 底下所有 HTML */
function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

/** 目標網址在 dist 中是否真的有對應的檔案 */
function resolves(target) {
  const clean = target.split('#')[0].split('?')[0];
  if (!clean || clean === '/') return existsSync(join(DIST, 'index.html'));
  const base = join(DIST, clean);
  return (
    existsSync(base) ||
    existsSync(base + '.html') ||
    existsSync(join(base, 'index.html'))
  );
}

const files = htmlFiles(DIST);
const broken = new Map();
let checked = 0;

for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const page = '/' + file.slice(DIST.length + 1).replace(/index\.html$/, '');
  const targets = new Set();

  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) targets.add(m[1]);

  for (const target of targets) {
    // 只檢查站內的絕對路徑；外部網址、mailto、tel、data: 與錨點不在範圍內
    if (!target.startsWith('/') || target.startsWith('//')) continue;
    checked++;
    if (resolves(target)) continue;
    if (!broken.has(target)) broken.set(target, new Set());
    broken.get(target).add(page);
  }
}

console.log(`檢查了 ${files.length} 個頁面、${checked} 個站內連結`);

if (broken.size) {
  console.error(`\n❌ 有 ${broken.size} 個連結指向不存在的頁面：`);
  for (const [target, pages] of broken) {
    const list = [...pages].slice(0, 3).join('、');
    console.error(`   ${target}`);
    console.error(`      出現在：${list}${pages.size > 3 ? ` 等 ${pages.size} 頁` : ''}`);
  }
  process.exit(1);
}
console.log('✅ 所有站內連結都指向存在的頁面');
