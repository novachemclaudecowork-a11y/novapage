/**
 * 站內搜尋的比對測試。
 *
 * 直接拿建置產生的真實索引來測，而不是自己捏假資料——
 * 這樣測到的就是客戶實際會得到的結果。
 *
 * 用法：npm run build && node scripts/test_search.mjs
 */
import { readFileSync } from 'node:fs';
import { searchItems, snippetOf } from '../src/scripts/search.js';

const index = JSON.parse(readFileSync('dist/search-index.json', 'utf8'));

let pass = 0;
const failures = [];

/** 搜尋後取回產品代稱，方便比對 */
const slugs = (query) => searchItems(index, query).map((i) => i.s);

function expectTop(query, slug) {
  const results = slugs(query);
  if (results[0] === slug) {
    console.log(`  ✅ 搜「${query}」→ 第一筆是 ${slug}`);
    pass++;
  } else {
    failures.push(`搜「${query}」預期第一筆為 ${slug}，實際為 ${results[0] ?? '（無結果）'}`);
    console.log(`  ❌ 搜「${query}」→ ${results[0] ?? '（無結果）'}`);
  }
}

function expectIncludes(query, slug) {
  const results = slugs(query);
  if (results.includes(slug)) {
    console.log(`  ✅ 搜「${query}」→ 找得到 ${slug}（共 ${results.length} 筆）`);
    pass++;
  } else {
    failures.push(`搜「${query}」預期含 ${slug}，實際為 ${results.join(', ') || '（無結果）'}`);
    console.log(`  ❌ 搜「${query}」→ 找不到 ${slug}`);
  }
}

function expectCount(query, count, label) {
  const results = slugs(query);
  if (results.length === count) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    failures.push(`${label}：預期 ${count} 筆，實際 ${results.length} 筆`);
    console.log(`  ❌ ${label}（${results.length} 筆）`);
  }
}

console.log(`索引共 ${index.length} 項產品\n`);

console.log('用產品名稱搜尋：');
expectTop('CW水性油墨', 'cw-waterbased');
expectTop('感光乳劑', 'emulsion');
expectTop('除鬼影劑', 'ghost-remover');

console.log('\n用產品型號搜尋（客戶最常用）：');
expectIncludes('BS-007', 'pu-elastic');
expectTop('EM-507', 'ghost-remover');
expectIncludes('ＢＳ－００７', 'pu-elastic');

console.log('\n用用途或材質搜尋（藏在說明裡）：');
expectIncludes('尼龍布', 'pu-elastic');
expectIncludes('刮刮樂', '410-scratch');

console.log('\n用分類名稱搜尋：');
expectIncludes('洗版劑', 'sw-cleaner');

console.log('\n多個關鍵字必須全部命中：');
const both = slugs('水性 棉布');
const onlyOne = slugs('水性');
if (both.length > 0 && both.length <= onlyOne.length) {
  console.log(`  ✅ 「水性 棉布」${both.length} 筆 ≤ 「水性」${onlyOne.length} 筆`);
  pass++;
} else {
  failures.push(`多關鍵字應收斂結果：「水性 棉布」${both.length} 筆、「水性」${onlyOne.length} 筆`);
  console.log('  ❌ 多關鍵字沒有收斂結果');
}
expectCount('水性 完全不存在的詞彙', 0, '其中一詞無法命中時不應有結果');

console.log('\n其他情況：');
expectCount('', 0, '空字串不回傳結果');
expectCount('   ', 0, '只有空白不回傳結果');
expectCount('zzzz不存在的產品zzzz', 0, '查無資料時回傳空結果');

console.log('\n大小寫與全形：');
expectTop('cw水性油墨', 'cw-waterbased');
expectTop('ＣＷ水性油墨', 'cw-waterbased');

console.log('\n結果片段：');
const snippet = snippetOf(index.find((i) => i.s === 'pu-elastic').t, '尼龍布');
if (snippet.includes('尼龍布')) {
  console.log(`  ✅ 片段包含關鍵字：${snippet.slice(0, 50)}…`);
  pass++;
} else {
  failures.push(`片段未包含關鍵字：${snippet}`);
  console.log('  ❌ 片段未包含關鍵字');
}

console.log(`\n${failures.length ? '❌' : '✅'} 通過 ${pass} 項${failures.length ? `，失敗 ${failures.length} 項` : '，全數符合預期'}`);
for (const f of failures) console.log('   ' + f);
process.exit(failures.length ? 1 : 0);
