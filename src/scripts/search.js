/**
 * 站內搜尋的比對邏輯。
 *
 * 中文沒有以空白斷詞，因此採子字串比對而非詞彙比對。
 * 使用者輸入的多個詞以空白分隔時，必須全部命中才算符合，
 * 這樣「水性 尼龍」才不會把只提到其中一個詞的產品也撈出來。
 *
 * 排序依命中的位置給分：產品名稱 > 產品編號 > 分類 > 說明內容，
 * 讓直接搜產品名或型號的人第一眼就看到要的東西。
 */
const WEIGHT = { name: 100, code: 60, group: 30, text: 10 };

/**
 * 把全形字元轉半形，讓搜「ＢＳ－００７」也能找到「BS-007」。
 *
 * 這裡連全形標點（－、＃、．）一併轉換，範圍是整個 U+FF01–U+FF5E。
 * 與內容清理不同，搜尋時關鍵字與被搜尋的文字都會經過同一道正規化，
 * 兩邊一致就不會有落差，也不影響網站上實際顯示的文字。
 */
function normalize(value) {
  return value
    .toLowerCase()
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
}

export function searchItems(items, query) {
  const terms = normalize(query).split(' ').filter(Boolean);
  if (!terms.length) return [];

  const results = [];
  for (const item of items) {
    const fields = {
      name: normalize(item.n),
      code: normalize(item.c),
      group: normalize(item.g),
      text: normalize(item.t),
    };

    let score = 0;
    // 每個詞都必須至少命中一個欄位，否則這項產品不算符合
    const allMatched = terms.every((term) => {
      let matched = false;
      for (const [field, value] of Object.entries(fields)) {
        if (!value.includes(term)) continue;
        matched = true;
        score += WEIGHT[field];
        // 從開頭就命中通常更貼近使用者要找的東西
        if (value.startsWith(term)) score += WEIGHT[field] / 2;
      }
      return matched;
    });

    if (allMatched) results.push({ item, score });
  }

  return results
    .sort((a, b) => b.score - a.score || a.item.n.localeCompare(b.item.n, 'zh-Hant'))
    .map((r) => r.item);
}

/** 取出包含關鍵字的片段，供搜尋結果顯示上下文 */
export function snippetOf(text, query, length = 90) {
  if (!text) return '';
  const terms = normalize(query).split(' ').filter(Boolean);
  const haystack = normalize(text);
  let index = -1;
  for (const term of terms) {
    const found = haystack.indexOf(term);
    if (found !== -1 && (index === -1 || found < index)) index = found;
  }
  if (index === -1) return text.slice(0, length) + (text.length > length ? '…' : '');
  const start = Math.max(0, index - 25);
  const end = Math.min(text.length, start + length);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

let cache = null;
export async function loadIndex() {
  if (!cache) {
    const res = await fetch('/search-index.json');
    if (!res.ok) throw new Error('搜尋索引載入失敗');
    cache = await res.json();
  }
  return cache;
}
