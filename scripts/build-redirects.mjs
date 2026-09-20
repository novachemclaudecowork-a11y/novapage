/**
 * 產生舊站 → 新站的轉址邏輯（src/lib/legacy-redirects.mjs）。
 *
 * 【為什麼用 Node 而不是 Python】
 * 後台改完內容後，Cloudflare 會自動重建網站。若這支程式需要 Python，
 * 而建置環境沒有，轉址就不會跟著內容更新。改用 Node 可確保它一定跑得起來，
 * 並已接為 npm 的 prebuild，每次建置前自動執行。
 *
 * 【為什麼不能只用 _redirects】
 * Cloudflare 的 _redirects 只比對路徑，不比對查詢字串。舊站的產品網址是
 * /view.html?id=127&m=1&pg=6 這種形式，路徑只有 /view.html，逐筆列出不會生效。
 *
 * 【為什麼鍵是 (m, m2, pg) 而不是 id】
 * 舊站忽略網址中的 id，實際顯示哪項產品由分類與分頁序號決定。
 * 且子分類的 pg 是該產品線內部的序號，與主分類各自獨立，兩者不可互換。
 * 詳見 docs/鏡像分析報告.md 第四節。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content');
const OUT_SHARED = join(ROOT, 'src', 'lib', 'legacy-redirects.mjs');
const OUT_REDIRECTS = join(ROOT, 'public', '_redirects');

// 舊站的純路徑網址（不帶查詢字串）→ 新站頁面
const PATH_MAP = {
  '/index.asp': '/',
  '/index.aspx': '/',
  '/index.html': '/',
  '/default.asp': '/',
  '/default.html': '/',
  '/main.asp': '/products/',
  '/main.html': '/products/',
  '/main.aspx': '/products/',
  '/news/index.asp': '/news/',
  '/news/index.aspx': '/news/',
  '/news/index.html': '/news/',
  '/inquiry.asp': '/inquiry/',
  '/inquiry.html': '/inquiry/',
  '/inquiry.aspx': '/inquiry/',
  '/inquiry_list.asp': '/inquiry/',
  '/members/login.asp': '/contact/',
  '/members/readme.asp': '/contact/',
};

// 舊站 /page/p.asp?id=N → 新站頁面
const PAGE_ID_MAP = {
  1: '/about/',
  7: '/contact/',
  9: '/support/',
  10: '/support/',
  11: '/about/',
  14: '/support/',
};

const PRODUCT_PATHS = ['/view.asp', '/view.html', '/view.aspx'];
const LISTING_PATHS = ['/product.asp', '/product.html', '/product.aspx'];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function main() {
  const products = readJson(join(CONTENT, 'products.json'));
  const categories = readJson(join(CONTENT, 'categories.json'));
  const legacy = readJson(join(ROOT, 'src', 'data', 'legacy-urls.json'));
  const corrections = readJson(join(ROOT, 'src', 'data', 'name-corrections.json'));

  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const slugByName = new Map(products.map((p) => [p.name, p.slug]));

  /** 產品的目的地：已上架導到產品頁，已下架導到所屬分類而非 404 */
  const destinationOf = (slug) => {
    const p = bySlug.get(slug);
    if (!p) return null;
    return p.published ? `/products/${p.slug}/` : `/category/${p.category}/`;
  };

  // (m, m2, pg) → 新網址
  const productMap = {};
  const unmapped = new Set();
  for (const info of Object.values(legacy)) {
    const name = corrections[info.name] ?? info.name;
    const slug = slugByName.get(name);
    if (!slug) {
      unmapped.add(info.name);
      continue;
    }
    const dest = destinationOf(slug);
    if (dest) productMap[`${info.m}|${info.m2 ?? ''}|${info.pg}`] = dest;
  }

  const categoryMap = {};
  const subcategoryMap = {};
  const subcategoryProductMap = {};
  for (const cat of categories) {
    if (cat.published !== false && cat.legacy_m) {
      categoryMap[cat.legacy_m] = `/category/${cat.slug}/`;
    }
    for (const sub of cat.children ?? []) {
      if (!sub.legacy_m2 || sub.published === false) continue;
      subcategoryMap[sub.legacy_m2] = `/category/${cat.slug}/${sub.slug}/`;
      // 多數產品線底下只有一項產品，導到產品頁比導到單品列表頁更貼近原內容
      const inSub = products.filter((p) => p.published && p.subcategory === sub.slug);
      if (inSub.length === 1) {
        subcategoryProductMap[sub.legacy_m2] = `/products/${inSub[0].slug}/`;
      }
    }
  }

  const j = (o) => JSON.stringify(o, null, 2);
  const shared = `// 舊站網址轉址的對照表與判斷邏輯。
// 由 scripts/build-redirects.mjs 產生，請勿手動編輯。
//
// 本模組只放純邏輯，不綁定平台。實際的進入點有兩個：
//   functions/_middleware.js   Cloudflare Pages 專案使用
//   worker/index.js            Cloudflare Workers 專案使用

const PATH_MAP = ${j(PATH_MAP)};

const PAGE_ID_MAP = ${j(PAGE_ID_MAP)};

// 鍵為 \`\${m}|\${m2}|\${pg}\` —— 舊站實際用來決定顯示哪項產品的組合。
// m2 不可省略：子分類的 pg 是該產品線內部的序號，與主分類各自獨立。
const PRODUCT_MAP = ${j(productMap)};

const CATEGORY_MAP = ${j(categoryMap)};

const SUBCATEGORY_MAP = ${j(subcategoryMap)};

// m2 → 該產品線底下唯一那項產品
const SUBCATEGORY_PRODUCT_MAP = ${j(subcategoryProductMap)};

const PRODUCT_PATHS = new Set(${j(PRODUCT_PATHS)});
const LISTING_PATHS = new Set(${j(LISTING_PATHS)});

/**
 * 依舊網址算出新網址，找不到對應時回傳 null。
 * 純函式，不依賴執行環境，可直接用 scripts/test_redirects.mjs 測試。
 */
export function resolveLegacy(pathname, params) {
  const path = pathname.toLowerCase();

  if (PATH_MAP[path]) return PATH_MAP[path];

  if (path === "/page/p.asp" || path === "/page/p.html") {
    return PAGE_ID_MAP[params.get("id")] ?? "/about/";
  }

  if (PRODUCT_PATHS.has(path)) {
    const m = params.get("m") ?? "";
    const m2 = params.get("m2") ?? "";
    const pg = params.get("pg") ?? "";

    // 帶 m2 時，pg 是該產品線內部的序號，與主分類的 pg 各自獨立。
    // 因此這裡**絕不可**退回用 \`m|pg\` 去查，否則會導到完全不相干的產品。
    if (m2) {
      return (
        PRODUCT_MAP[\`\${m}|\${m2}|\${pg}\`] ??
        SUBCATEGORY_PRODUCT_MAP[m2] ??
        SUBCATEGORY_MAP[m2] ??
        CATEGORY_MAP[m] ??
        "/products/"
      );
    }
    return PRODUCT_MAP[\`\${m}||\${pg}\`] ?? CATEGORY_MAP[m] ?? "/products/";
  }

  if (LISTING_PATHS.has(path)) {
    const m2 = params.get("m2");
    if (m2 && SUBCATEGORY_MAP[m2]) return SUBCATEGORY_MAP[m2];
    return CATEGORY_MAP[params.get("m")] ?? "/products/";
  }

  return null;
}

/** 將請求轉為 301 回應；沒有對應時回傳 null 交給後續處理。 */
export function legacyRedirectResponse(request) {
  const url = new URL(request.url);
  const target = resolveLegacy(url.pathname, url.searchParams);
  if (!target) return null;
  return Response.redirect(new URL(target, url.origin).href, 301);
}
`;

  mkdirSync(dirname(OUT_SHARED), { recursive: true });
  writeFileSync(OUT_SHARED, shared, 'utf8');

  const lines = [
    '# 純路徑轉址備援。帶查詢字串的舊網址由 worker/index.js 處理，',
    '# 因為 _redirects 不比對查詢字串。',
    '# 由 scripts/build-redirects.mjs 產生，請勿手動編輯。',
    '',
    ...Object.entries(PATH_MAP).map(([from, to]) => `${from} ${to} 301`),
  ];
  writeFileSync(OUT_REDIRECTS, lines.join('\n') + '\n', 'utf8');

  const unpublished = products.filter((p) => !p.published).length;
  console.log(`產品轉址：${Object.keys(productMap).length} 組 (m, m2, pg)`);
  console.log(`  上架 ${products.length - unpublished} 項／下架 ${unpublished} 項`);
  console.log(`主分類：${Object.keys(categoryMap).length}　產品線：${Object.keys(subcategoryMap).length}`);
  console.log(`產品線 → 單一產品：${Object.keys(subcategoryProductMap).length}`);
  if (unmapped.size) {
    console.log(`⚠️  ${unmapped.size} 個舊產品名稱已無對應（多為已下架）：${[...unmapped].join(', ')}`);
  }
}

main();
