// 舊站網址轉址的對照表與判斷邏輯。
// 由 scripts/build-redirects.mjs 產生，請勿手動編輯。
//
// 本模組只放純邏輯，不綁定平台。實際的進入點有兩個：
//   functions/_middleware.js   Cloudflare Pages 專案使用
//   worker/index.js            Cloudflare Workers 專案使用

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
// m2 不可省略：子分類的 pg 是該產品線內部的序號，與主分類各自獨立。
const PRODUCT_MAP = {
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
  "10": "/category/cab-381/"
};

const SUBCATEGORY_MAP = {
  "141": "/category/screen-inks/metallic-glitter/",
  "159": "/category/platemaking/other-supplies/"
};

// m2 → 該產品線底下唯一那項產品
const SUBCATEGORY_PRODUCT_MAP = {
  "129": "/products/mpv/",
  "130": "/products/pet-label/",
  "131": "/products/pet-water-transfer/",
  "132": "/products/410-scratch/",
  "133": "/products/pd-metal-glass/",
  "134": "/products/cp-color-paste/",
  "135": "/products/pu-elastic/",
  "136": "/products/cw-waterbased/",
  "137": "/products/ti-heat-transfer/",
  "138": "/products/ri-rub-transfer/",
  "139": "/products/pp/",
  "140": "/products/ot-sandblast/",
  "142": "/products/bs-thinner/",
  "143": "/products/sw-cleaner/",
  "144": "/products/pp-primer/",
  "145": "/products/anti-clog/",
  "146": "/products/wiping-agent/",
  "147": "/products/defoamer/",
  "148": "/products/thickener/",
  "149": "/products/matting-paste/",
  "150": "/products/emulsion/",
  "151": "/products/ink-remover/",
  "152": "/products/ghost-remover/",
  "153": "/products/stencil-remover/",
  "154": "/products/degreaser/",
  "155": "/products/block-out/",
  "156": "/products/edge-sealer/",
  "157": "/products/hardener/",
  "158": "/products/frame-adhesive/",
  "168": "/products/rubber-primer/"
};

const PRODUCT_PATHS = new Set([
  "/view.asp",
  "/view.html",
  "/view.aspx"
]);
const LISTING_PATHS = new Set([
  "/product.asp",
  "/product.html",
  "/product.aspx"
]);

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
    // 因此這裡**絕不可**退回用 `m|pg` 去查，否則會導到完全不相干的產品。
    if (m2) {
      return (
        PRODUCT_MAP[`${m}|${m2}|${pg}`] ??
        SUBCATEGORY_PRODUCT_MAP[m2] ??
        SUBCATEGORY_MAP[m2] ??
        CATEGORY_MAP[m] ??
        "/products/"
      );
    }
    return PRODUCT_MAP[`${m}||${pg}`] ?? CATEGORY_MAP[m] ?? "/products/";
  }

  if (LISTING_PATHS.has(path)) {
    const m2 = params.get("m2");
    if (m2) {
      // 只有一項產品的產品線不再有列表頁，導到那項產品才不會少一層內容
      return (
        SUBCATEGORY_PRODUCT_MAP[m2] ??
        SUBCATEGORY_MAP[m2] ??
        CATEGORY_MAP[params.get("m")] ??
        "/products/"
      );
    }
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
