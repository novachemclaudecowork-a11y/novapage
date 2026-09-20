#!/usr/bin/env python3
"""
產生舊站 → 新站的 301 轉址設定。

⚠️ 為什麼不能只用 _redirects：
Cloudflare Pages 的 _redirects 檔**只比對路徑，不比對查詢字串**。
舊站的產品網址形如 /view.html?id=127&m=1&pg=5，路徑部分只有 /view.html，
因此逐筆列出完整舊網址在 Cloudflare 上不會生效。

解法：用 Pages Functions 讀取查詢參數後再導向。
又因為舊站真正決定產品的是 (m, pg)（見 docs/鏡像分析報告.md 第四節），
對照表只需 40 筆 (m,pg) → slug，而非 160 筆完整網址。

用法：
    python3 scripts/build_redirects.py
輸出：
    functions/_middleware.js   Cloudflare Pages Function，處理所有舊網址
    public/_redirects          純路徑轉址（不需查詢字串者），作為備援
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CATALOG = ROOT / "src" / "data" / "catalog.json"
LEGACY = ROOT / "src" / "data" / "legacy-urls.json"
CORRECTIONS = ROOT / "src" / "data" / "name-corrections.json"
FUNCTIONS = ROOT / "functions" / "_middleware.js"
REDIRECTS = ROOT / "public" / "_redirects"

# 舊站的純路徑網址（不帶查詢字串）→ 新站頁面
PATH_MAP = {
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
    "/members/readme.asp": "/contact/",
}

# 舊站 /page/p.asp?id=N → 新站頁面
PAGE_ID_MAP = {
    "1": "/about/",
    "7": "/contact/",
    "9": "/support/",
    "10": "/support/",
    "11": "/about/",
    "14": "/support/",
}

# 帶查詢字串的舊產品／分類網址，其路徑部分
PRODUCT_PATHS = ["/view.asp", "/view.html", "/view.aspx"]
LISTING_PATHS = ["/product.asp", "/product.html", "/product.aspx"]


def main() -> int:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    legacy = json.loads(LEGACY.read_text(encoding="utf-8"))
    corrections = json.loads(CORRECTIONS.read_text(encoding="utf-8"))

    # (m, m2, pg) → 產品新網址。
    #
    # m2 不可省略：子分類頁（例如「其他資材」m2=159）的 pg 是該子分類內部的
    # 序號，與主分類的 pg 各自獨立。例如 m=4&pg=2 是「補版膠」，
    # 但 m=4&m2=159&pg=2 是「刮刀/刮膠」。只用 (m, pg) 會導到錯誤的產品。
    slug_by_name = {p["name"]: p["slug"] for p in catalog["products"]}
    product_map: dict[str, str] = {}
    unmapped: set[str] = set()
    for info in legacy.values():
        name = corrections.get(info["name"], info["name"])
        slug = slug_by_name.get(name)
        if slug is None:
            unmapped.add(info["name"])
            continue
        key = f'{info["m"]}|{info.get("m2", "")}|{info["pg"]}'
        product_map[key] = f"/products/{slug}/"
    # m → 主分類新網址
    category_map = {c["legacy_m"]: f'/category/{c["slug"]}/' for c in catalog["categories"]}
    # m2 → 產品線新網址
    sub_map = {
        s["legacy_m2"]: f'/category/{c["slug"]}/{s["slug"]}/'
        for c in catalog["categories"]
        for s in c["children"]
    }

    js = f"""// 舊站網址轉址。
// 由 scripts/build_redirects.py 產生，請勿手動編輯。
//
// Cloudflare Pages 的 _redirects 只比對路徑，無法處理舊站
// /view.html?id=127&m=1&pg=5 這種以查詢字串決定內容的網址，
// 因此改由本 Function 讀取查詢參數後再導向。

const PATH_MAP = {json.dumps(PATH_MAP, ensure_ascii=False, indent=2)};

const PAGE_ID_MAP = {json.dumps(PAGE_ID_MAP, ensure_ascii=False, indent=2)};

// 鍵為 `${{m}}|${{m2}}|${{pg}}` —— 舊站實際用來決定顯示哪項產品的組合。
// m2 不可省略：子分類頁的 pg 是該子分類內部的序號，與主分類各自獨立。
const PRODUCT_MAP = {json.dumps(product_map, ensure_ascii=False, indent=2)};

const CATEGORY_MAP = {json.dumps(category_map, ensure_ascii=False, indent=2)};

const SUBCATEGORY_MAP = {json.dumps(sub_map, ensure_ascii=False, indent=2)};

const PRODUCT_PATHS = new Set({json.dumps(PRODUCT_PATHS)});
const LISTING_PATHS = new Set({json.dumps(LISTING_PATHS)});

/**
 * 依舊網址算出新網址，找不到對應時回傳 null。
 * 抽成獨立函式以便用 scripts/test_redirects.mjs 測試。
 */
export function resolveLegacy(pathname, params) {{
  const path = pathname.toLowerCase();

  if (PATH_MAP[path]) return PATH_MAP[path];

  if (path === "/page/p.asp" || path === "/page/p.html") {{
    return PAGE_ID_MAP[params.get("id")] ?? "/about/";
  }}

  if (PRODUCT_PATHS.has(path)) {{
    const m = params.get("m") ?? "";
    const m2 = params.get("m2") ?? "";
    const pg = params.get("pg") ?? "";
    const hit = PRODUCT_MAP[`${{m}}|${{m2}}|${{pg}}`] ?? PRODUCT_MAP[`${{m}}||${{pg}}`];
    if (hit) return hit;
    // 沒有 pg 或對不到時，退而導向所屬分類或產品線，避免變成 404
    if (m2 && SUBCATEGORY_MAP[m2]) return SUBCATEGORY_MAP[m2];
    return CATEGORY_MAP[m] ?? "/products/";
  }}

  if (LISTING_PATHS.has(path)) {{
    const m2 = params.get("m2");
    if (m2 && SUBCATEGORY_MAP[m2]) return SUBCATEGORY_MAP[m2];
    return CATEGORY_MAP[params.get("m")] ?? "/products/";
  }}

  return null;
}}

export async function onRequest(context) {{
  const url = new URL(context.request.url);
  const target = resolveLegacy(url.pathname, url.searchParams);

  if (target) {{
    return Response.redirect(new URL(target, url.origin).href, 301);
  }}
  return context.next();
}}
"""

    FUNCTIONS.parent.mkdir(parents=True, exist_ok=True)
    FUNCTIONS.write_text(js, encoding="utf-8")

    # 純路徑轉址另外寫一份 _redirects 作為備援（Function 未啟用時仍有基本轉址）
    lines = [
        "# 純路徑轉址備援。帶查詢字串的舊網址由 functions/_middleware.js 處理，",
        "# 因為 _redirects 不比對查詢字串。",
        "# 由 scripts/build_redirects.py 產生，請勿手動編輯。",
        "",
    ]
    lines += [f"{old} {new} 301" for old, new in PATH_MAP.items()]
    REDIRECTS.parent.mkdir(parents=True, exist_ok=True)
    REDIRECTS.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"寫入 {FUNCTIONS.relative_to(ROOT)}")
    print(f"  產品轉址：{len(product_map)} 組 (m, m2, pg)")
    if unmapped:
        print(f"  ⚠️  有 {len(unmapped)} 個舊產品名稱找不到對應：{', '.join(sorted(unmapped))}")
    print(f"  主分類：{len(category_map)} 筆   產品線：{len(sub_map)} 筆")
    print(f"  靜態頁：{len(PATH_MAP)} 筆路徑 + {len(PAGE_ID_MAP)} 筆 p.asp?id=")
    print(f"寫入 {REDIRECTS.relative_to(ROOT)}（{len(PATH_MAP)} 筆備援）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
