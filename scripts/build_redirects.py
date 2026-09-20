#!/usr/bin/env python3
"""
產生部署平台使用的 301 轉址設定檔。

舊站的產品網址已被 Google 收錄，新站上線時若不設轉址，
既有的搜尋排名會流失。本程式把 src/data/redirects.json
輸出為各平台的設定格式。

用法：
    python3 scripts/build_redirects.py
輸出：
    public/_redirects   Cloudflare Pages / Netlify 格式
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
REDIRECTS = ROOT / "src" / "data" / "redirects.json"
OUT = ROOT / "public" / "_redirects"

# 舊站選單頁 → 新站對應頁
STATIC_MAP = {
    "/index.aspx": "/",
    "/default.html": "/",
    "/main.asp": "/products/",
    "/main.html": "/products/",
    "/page/p.asp?id=1": "/about/",
    "/page/p.asp?id=7": "/contact/",
    "/page/p.asp?id=9": "/support/",
    "/page/p.asp?id=10": "/support/",
    "/page/p.asp?id=11": "/about/",
    "/page/p.asp?id=14": "/support/",
    "/news/index.aspx": "/news/",
    "/inquiry.asp": "/inquiry/",
    "/inquiry.html": "/inquiry/",
    "/inquiry_list.asp": "/inquiry/",
}


def main() -> int:
    product_redirects = json.loads(REDIRECTS.read_text(encoding="utf-8"))
    lines = [
        "# 舊站 → 新站 301 轉址",
        "# 由 scripts/build_redirects.py 產生，請勿手動編輯",
        "",
        "# 選單頁面",
    ]
    for old, new in STATIC_MAP.items():
        lines.append(f"{old} {new} 301")

    lines += ["", "# 產品頁面"]
    for old, new in sorted(product_redirects.items()):
        lines.append(f"{old} {new} 301")

    # 未逐一列出的舊網址，至少導到產品列表而非 404
    lines += [
        "",
        "# 未逐一對應到的舊網址，導向產品列表而非 404",
        "/view.asp /products/ 301",
        "/view.html /products/ 301",
        "/view.aspx /products/ 301",
        "/product.asp /products/ 301",
        "/product.html /products/ 301",
        "/product.aspx /products/ 301",
    ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"寫入 {OUT.relative_to(ROOT)}")
    print(f"  選單頁轉址：{len(STATIC_MAP)} 筆")
    print(f"  產品頁轉址：{len(product_redirects)} 筆")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
