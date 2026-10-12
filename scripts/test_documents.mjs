/**
 * 安全資料表與說明書（PDF）的測試。
 *
 * 後台可以上傳、也存得進產品資料裡，但產品頁若沒有把它們印出來，
 * 客戶就永遠看不到——最新訊息與這裡都發生過同一種錯：
 * 後台做好了，前台沒接上。所以這支測試一定要看真實建置的產物。
 *
 * 結束時（含失敗或中斷）一定會把原本的 content/products.json 放回去。
 *
 * 用法：node scripts/test_documents.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';

const PRODUCTS = 'content/products.json';
const original = readFileSync(PRODUCTS, 'utf8');
// check-assets 會檢查文件是否真的存在，所以測試期間放一個假的 PDF
const DOC_DIR = 'public/documents';
const DOC_FILE = `${DOC_DIR}/test-sds.pdf`;
const docDirExisted = existsSync(DOC_DIR);

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

const build = () => execFileSync('npm', ['run', 'build'], { encoding: 'utf8', stdio: 'pipe' });

try {
  mkdirSync(DOC_DIR, { recursive: true });
  writeFileSync(DOC_FILE, '%PDF-1.4\n% 測試用的空檔案\n');

  const products = JSON.parse(original);
  const withDoc = products.find((p) => p.published);
  const withoutDoc = products.find((p) => p.published && p.slug !== withDoc.slug);
  withDoc.documents = [
    { label: '安全資料表（SDS）', file: '/documents/test-sds.pdf' },
    { label: '產品說明書', file: '/documents/test-sds.pdf' },
  ];
  withoutDoc.documents = [];
  writeFileSync(PRODUCTS, JSON.stringify(products, null, 2) + '\n');

  build();

  console.log('產品頁：');
  const page = readFileSync(`dist/products/${withDoc.slug}/index.html`, 'utf8');
  check('有「相關文件下載」區塊', page.includes('相關文件下載'));
  check('列出每一份文件',
    page.includes('安全資料表（SDS）') && page.includes('產品說明書'));
  check('連結指向實際的檔案', page.includes('href="/documents/test-sds.pdf"'));
  check('標示為 PDF', page.includes('>PDF<'));

  console.log('\n沒有文件的產品：');
  const bare = readFileSync(`dist/products/${withoutDoc.slug}/index.html`, 'utf8');
  check('不會出現空的下載區塊', !bare.includes('相關文件下載'));

  console.log('\n檔案本身：');
  check('PDF 會被複製到網站上', existsSync('dist/documents/test-sds.pdf'));
} finally {
  writeFileSync(PRODUCTS, original);
  rmSync(DOC_FILE, { force: true });
  if (!docDirExisted) rmSync(DOC_DIR, { recursive: true, force: true });
  // 把 dist/ 還原成真實資料的狀態，避免影響後續的連結與資源檢查
  build();
}

console.log(`\n${failures.length ? '❌' : '✅'} 通過 ${pass} 項${failures.length ? `，失敗 ${failures.length} 項` : '，全數符合預期'}`);
for (const f of failures) console.log('   ' + f);
process.exit(failures.length ? 1 : 0);
