/**
 * 內文格式（HTML／Markdown）的測試。
 *
 * 後台每一則訊息、每一項產品說明都各自記著自己用哪種格式寫。
 * 這裡除了測轉換函式本身，也會把測試資料寫進 content/、真的跑一次建置，
 * 確認前台頁面確實照著格式呈現——後台預覽對了但前台沒接上，
 * 這種錯只測函式是測不出來的（最新訊息就發生過一次）。
 *
 * 結束時（含失敗或中斷）一定會把原本的 content/ 檔案放回去。
 *
 * 用法：node scripts/test_markdown.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { renderBody, normalizeFormat } from '../src/lib/richtext.js';

const NEWS = 'content/news.json';
const PRODUCTS = 'content/products.json';
const originals = { [NEWS]: readFileSync(NEWS, 'utf8'), [PRODUCTS]: readFileSync(PRODUCTS, 'utf8') };

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

console.log('格式判斷：');
// 舊站匯入的產品說明都沒有這個欄位，若預設成 Markdown，<p> 與 <table> 會整個走樣
check('沒填格式時當成 HTML', normalizeFormat(undefined) === 'html');
check('空字串也當成 HTML', normalizeFormat('') === 'html');
check('無法辨識的值當成 HTML', normalizeFormat('rtf') === 'html');
check('markdown 就是 markdown', normalizeFormat('markdown') === 'markdown');

console.log('\nHTML 模式：');
check('原樣輸出，不做任何轉換',
  renderBody('<p>原本就是 HTML</p>', 'html') === '<p>原本就是 HTML</p>');
check('Markdown 語法不生效', renderBody('**粗體**', 'html') === '**粗體**');
check('空字串回傳空字串', renderBody('', 'html') === '');

console.log('\nMarkdown 模式：');
const md = renderBody('## 小標題\n\n- 甲\n- 乙\n\n**粗體**與[連結](/products/)', 'markdown');
check('標題', md.includes('<h2>小標題</h2>'), md);
check('項目清單', md.includes('<li>甲</li>') && md.includes('<li>乙</li>'), md);
check('粗體', md.includes('<strong>粗體</strong>'), md);
check('連結', md.includes('href="/products/"'), md);
// 使用者在輸入框按 Enter 就是想換行，不該要求空一行
check('單一換行就換行', renderBody('第一行\n第二行', 'markdown').includes('<br>'));
// 舊內容原封不動切成 Markdown 時不能壞掉
check('可以直接混用 HTML 標籤',
  renderBody('<p>既有的 HTML</p>', 'markdown').includes('<p>既有的 HTML</p>'));

const build = () => execFileSync('npm', ['run', 'build'], { encoding: 'utf8', stdio: 'pipe' });
const read = (p) => readFileSync(p, 'utf8');

try {
  writeFileSync(NEWS, JSON.stringify([
    { slug: 'md-post', title: 'Markdown 訊息', date: '2026-08-01',
      body: '## 公告\n\n- 第一項\n- 第二項', format: 'markdown', published: true },
    { slug: 'html-post', title: 'HTML 訊息', date: '2026-07-01',
      body: '<p>本來就是 HTML</p>', format: 'html', published: true },
    { slug: 'legacy-post', title: '沒記格式的舊訊息', date: '2026-06-01',
      body: '<p>舊資料</p>', published: true },
  ], null, 2) + '\n');

  const products = JSON.parse(originals[PRODUCTS]);
  const target = products.find((p) => p.published);
  target.spec_html = '## 用途\n\n- 尼龍布\n- 棉布';
  target.spec_format = 'markdown';
  writeFileSync(PRODUCTS, JSON.stringify(products, null, 2) + '\n');

  build();

  console.log('\n最新訊息頁：');
  const mdPage = read('dist/news/md-post/index.html');
  check('Markdown 轉成了 HTML',
    mdPage.includes('<h2>公告</h2>') && mdPage.includes('<li>第一項</li>'));
  check('頁面上看不到原始的 Markdown 符號', !mdPage.includes('## 公告'));
  // 摘要與 meta description 取的是轉換後的純文字，不該留下 ## 這類符號
  check('列表頁摘要不含 Markdown 符號', !read('dist/news/index.html').includes('## 公告'));
  check('HTML 格式的訊息照常呈現',
    read('dist/news/html-post/index.html').includes('<p>本來就是 HTML</p>'));
  check('沒記格式的舊訊息當成 HTML',
    read('dist/news/legacy-post/index.html').includes('<p>舊資料</p>'));

  console.log('\n產品頁：');
  const productPage = read(`dist/products/${target.slug}/index.html`);
  check('產品說明的 Markdown 也轉成了 HTML',
    productPage.includes('<h2>用途</h2>') && productPage.includes('<li>尼龍布</li>'));
  check('頁面上看不到原始的 Markdown 符號', !productPage.includes('## 用途'));
  const index = JSON.parse(read('dist/search-index.json'));
  check('搜尋索引收錄的是轉換後的文字',
    !(index.find((i) => i.s === target.slug)?.t ?? '').includes('## '));
} finally {
  for (const [file, content] of Object.entries(originals)) writeFileSync(file, content);
  // 把 dist/ 還原成真實資料的狀態，避免影響後續的連結檢查
  build();
}

console.log(`\n${failures.length ? '❌' : '✅'} 通過 ${pass} 項${failures.length ? `，失敗 ${failures.length} 項` : '，全數符合預期'}`);
for (const f of failures) console.log('   ' + f);
process.exit(failures.length ? 1 : 0);
