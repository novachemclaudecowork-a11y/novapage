// 舊站網址轉址。
// 由 scripts/build_redirects.py 產生，請勿手動編輯。
//
// Cloudflare Pages 的 _redirects 只比對路徑，無法處理舊站
// /view.html?id=127&m=1&pg=5 這種以查詢字串決定內容的網址，
// 因此改由本 Function 讀取查詢參數後再導向。

const PATH_MAP = {
  "/index.asp": "/",
  "/index.aspx": "/",
  "/index.html": "/",
  "/default.asp": "/",
  "/default.html": "/",
  "/main.asp": "/products/",
  "/main.html": "/products/",
  "/main.aspx": "/products/",
  "/news/index.asp": "/news/",
  "/news/index.aspx": "/news/",
  "/news/index.html": "/news/",
  "/inquiry.asp": "/inquiry/",
  "/inquiry.html": "/inquiry/",
  "/inquiry.aspx": "/inquiry/",
  "/inquiry_list.asp": "/inquiry/",
  "/members/login.asp": "/contact/",
  "/members/readme.asp": "/contact/"
};

const PAGE_ID_MAP = {
  "1": "/about/",
  "7": "/contact/",
  "9": "/support/",
  "10": "/support/",
  "11": "/about/",
  "14": "/support/"
};

// 鍵為 `${m}|${m2}|${pg}` —— 舊站實際用來決定顯示哪項產品的組合。
// m2 不可省略：子分類頁的 pg 是該子分類內部的序號，與主分類各自獨立。
const PRODUCT_MAP = {
  "5||1": "/products/wuji-pen-ink/",
  "1||10": "/products/mpv/",
  "1||11": "/products/pet-label/",
  "1||1": "/products/pet-water-transfer/",
  "1||2": "/products/410-scratch/",
  "1||3": "/products/pd-metal-glass/",
  "1||4": "/products/cp-color-paste/",
  "1||5": "/products/pu-elastic/",
  "1||6": "/products/cw-waterbased/",
  "1||7": "/products/ti-heat-transfer/",
  "1||8": "/products/ri-rub-transfer/",
  "1||9": "/products/ot-sandblast/",
  "1||12": "/products/pp/",
  "2||1": "/products/defoamer/",
  "2||3": "/products/wiping-agent/",
  "2||2": "/products/bs-thinner/",
  "2||8": "/products/thickener/",
  "2||9": "/products/sw-cleaner/",
  "2||5": "/products/rubber-primer/",
  "2||7": "/products/matting-paste/",
  "2||6": "/products/pp-primer/",
  "2||4": "/products/anti-clog/",
  "4|159|6": "/products/release-paper/",
  "4|159|7": "/products/other-supplies/",
  "4||15": "/products/release-paper/",
  "4||16": "/products/other-supplies/",
  "4||11": "/products/squeegee/",
  "4||9": "/products/degreaser/",
  "4||10": "/products/emulsion/",
  "4||6": "/products/frame-adhesive/",
  "4||8": "/products/ghost-remover/",
  "4||7": "/products/ink-remover/",
  "4||3": "/products/hardener/",
  "4||5": "/products/hand-cleaner/",
  "4||4": "/products/stencil-remover/",
  "4||1": "/products/edge-sealer/",
  "4||2": "/products/block-out/",
  "4|159|2": "/products/squeegee/",
  "4|159|1": "/products/hand-cleaner/",
  "4|159|4": "/products/spatula/",
  "4|159|5": "/products/opp-release-film/",
  "4||13": "/products/spatula/",
  "4||14": "/products/opp-release-film/",
  "4|159|3": "/products/woodfree-paper/",
  "4||12": "/products/woodfree-paper/",
  "1||13": "/products/silicone/",
  "10||1": "/products/cab-381/"
};

const CATEGORY_MAP = {
  "1": "/category/screen-inks/",
  "2": "/category/thinners-cleaners/",
  "4": "/category/platemaking/",
  "10": "/category/cab-381/",
  "5": "/category/pen-inks/"
};

const SUBCATEGORY_MAP = {
  "129": "/category/screen-inks/mpv/",
  "130": "/category/screen-inks/pet-label/",
  "131": "/category/screen-inks/pet-water-transfer/",
  "132": "/category/screen-inks/410-scratch/",
  "133": "/category/screen-inks/pd-metal-glass/",
  "134": "/category/screen-inks/cp-color-paste/",
  "135": "/category/screen-inks/pu-elastic/",
  "136": "/category/screen-inks/cw-waterbased/",
  "137": "/category/screen-inks/ti-heat-transfer/",
  "138": "/category/screen-inks/ri-rub-transfer/",
  "139": "/category/screen-inks/pp/",
  "140": "/category/screen-inks/ot-sandblast/",
  "141": "/category/screen-inks/metallic-glitter/",
  "142": "/category/thinners-cleaners/bs-thinner/",
  "143": "/category/thinners-cleaners/sw-cleaner/",
  "144": "/category/thinners-cleaners/pp-primer/",
  "145": "/category/thinners-cleaners/anti-clog/",
  "146": "/category/thinners-cleaners/wiping-agent/",
  "147": "/category/thinners-cleaners/defoamer/",
  "148": "/category/thinners-cleaners/thickener/",
  "149": "/category/thinners-cleaners/matting-paste/",
  "168": "/category/thinners-cleaners/rubber-primer/",
  "150": "/category/platemaking/emulsion/",
  "151": "/category/platemaking/ink-remover/",
  "152": "/category/platemaking/ghost-remover/",
  "153": "/category/platemaking/stencil-remover/",
  "154": "/category/platemaking/degreaser/",
  "155": "/category/platemaking/block-out/",
  "156": "/category/platemaking/edge-sealer/",
  "157": "/category/platemaking/hardener/",
  "158": "/category/platemaking/frame-adhesive/",
  "159": "/category/platemaking/other-supplies/"
};

const PRODUCT_PATHS = new Set(["/view.asp", "/view.html", "/view.aspx"]);
const LISTING_PATHS = new Set(["/product.asp", "/product.html", "/product.aspx"]);

/**
 * 依舊網址算出新網址，找不到對應時回傳 null。
 * 抽成獨立函式以便用 scripts/test_redirects.mjs 測試。
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
    const hit = PRODUCT_MAP[`${m}|${m2}|${pg}`] ?? PRODUCT_MAP[`${m}||${pg}`];
    if (hit) return hit;
    // 沒有 pg 或對不到時，退而導向所屬分類或產品線，避免變成 404
    if (m2 && SUBCATEGORY_MAP[m2]) return SUBCATEGORY_MAP[m2];
    return CATEGORY_MAP[m] ?? "/products/";
  }

  if (LISTING_PATHS.has(path)) {
    const m2 = params.get("m2");
    if (m2 && SUBCATEGORY_MAP[m2]) return SUBCATEGORY_MAP[m2];
    return CATEGORY_MAP[params.get("m")] ?? "/products/";
  }

  return null;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const target = resolveLegacy(url.pathname, url.searchParams);

  if (target) {
    return Response.redirect(new URL(target, url.origin).href, 301);
  }
  return context.next();
}
