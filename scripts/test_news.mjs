/**
 * 最新訊息的建置測試。
 *
 * 會暫時把 content/news.json 換成測試資料、真的跑一次建置，
 * 再檢查 dist/ 裡產生了什麼——因為先前的錯誤正是「後台存得進去、
 * 前台卻根本沒讀這份檔案」，只測函式是測不出來的。
 * 結束時（含失敗或中斷）一定會把原本的 content/news.json 放回去。
 *
 * 用法：node scripts/test_news.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const NEWS = 'content/news.json';
const original = readFileSync(NEWS, 'utf8');

let pass = 0;
const failures = [];

function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    failures.push(`${label}${detail ? `（${detail}）` : ''}`);
    console.log(`  ❌ ${label}${detail ? `　${detail}` : ''}`);
  }
}

const fixture = [
  { slug: 'older', title: '較舊的訊息', date: '2026-01-05', body: '<p>舊內容</p>', published: true },
  { slug: 'newer', title: '較新的訊息', date: '2026-08-01', body: '<p>新內容</p>', published: true },
  { slug: 'draft', title: '還沒寫完的草稿', date: '2026-09-01', body: '<p>不該出現</p>', published: false },
  { slug: 'untitled', title: '   ', date: '2026-09-02', body: '', published: true },
];

const build = () =>
  execFileSync('npm', ['run', 'build'], { encoding: 'utf8', stdio: 'pipe' });
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

try {
  writeFileSync(NEWS, JSON.stringify(fixture, null, 2) + '\n');
  build();

  const list = read('dist/news/index.html');
  const home = read('dist/index.html');

  console.log('已發布的訊息：');
  check('列表頁列出已發布的訊息', list?.includes('較新的訊息') && list?.includes('較舊的訊息'));
  check('每則都有自己的頁面', !!read('dist/news/newer/index.html') && !!read('dist/news/older/index.html'));
  check('內文以 HTML 呈現', read('dist/news/newer/index.html')?.includes('<p>新內容</p>'));
  check('首頁也看得到', home?.includes('較新的訊息'));

  console.log('\n排序：');
  const iNew = list.indexOf('較新的訊息');
  const iOld = list.indexOf('較舊的訊息');
  check('日期新的排前面', iNew >= 0 && iOld >= 0 && iNew < iOld, `新在 ${iNew}、舊在 ${iOld}`);

  console.log('\n草稿與未完成的項目：');
  check('未勾選發布的不會出現在列表頁', !list.includes('還沒寫完的草稿'));
  check('未勾選發布的不會有自己的頁面', !existsSync('dist/news/draft/index.html'));
  check('未勾選發布的不會出現在首頁', !home.includes('還沒寫完的草稿'));
  check('沒有標題的空白項目不會產生頁面', !existsSync('dist/news/untitled/index.html'));

  console.log('\n完全沒有訊息時：');
  writeFileSync(NEWS, '[]\n');
  build();
  const empty = read('dist/news/index.html');
  check('列表頁顯示「目前沒有最新訊息」', empty?.includes('目前沒有最新訊息'));
  check('首頁不出現最新訊息區塊', !read('dist/index.html')?.includes('home-news'));
} finally {
  writeFileSync(NEWS, original);
  // 把 dist/ 還原成真實資料的狀態，避免影響後續的連結檢查
  build();
}

console.log(`\n${failures.length ? '❌' : '✅'} 通過 ${pass} 項${failures.length ? `，失敗 ${failures.length} 項` : '，全數符合預期'}`);
for (const f of failures) console.log('   ' + f);
process.exit(failures.length ? 1 : 0);
