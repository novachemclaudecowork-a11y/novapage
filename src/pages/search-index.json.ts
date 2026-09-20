import type { APIRoute } from 'astro';
import { categories, plainText, products } from '../data/site';

/*
 * 站內搜尋用的索引，於建置時產生為靜態檔案。
 *
 * 中文沒有以空白斷詞，對 39 項產品的型錄而言，直接做子字串比對就夠準也夠快，
 * 不需要引入斷詞或搜尋套件。索引在使用者第一次要搜尋時才下載，
 * 不影響一般瀏覽的載入速度。
 *
 * 說明文字截為前 400 字：足以涵蓋用途、網目、乾燥方式等客戶常搜尋的內容，
 * 又能把索引控制在約 40 KB。
 */
const SPEC_LIMIT = 400;

export const GET: APIRoute = () => {
  const categoryName = new Map(categories.map((c) => [c.slug, c.name]));
  const subName = new Map(
    categories.flatMap((c) => c.children.map((s) => [s.slug, s.name] as const)),
  );

  const items = products.map((product) => ({
    s: product.slug,
    n: product.name,
    c: product.code ?? '',
    // 分類與產品線名稱一併納入，讓客戶搜「洗版劑」也找得到底下的品項
    g: [categoryName.get(product.category), subName.get(product.subcategory ?? '')]
      .filter(Boolean)
      .join(' '),
    t: plainText(product.spec_html).slice(0, SPEC_LIMIT),
    i: product.images[0] ?? '',
  }));

  return new Response(JSON.stringify(items), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
