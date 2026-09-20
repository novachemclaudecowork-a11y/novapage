#!/usr/bin/env python3
"""
把產生出來的 catalog.json 轉成可供後台編輯的內容檔。

【為什麼要做這件事】
在此之前，產品資料是每次建置時從 site-mirror/ 重新萃取產生的，
任何人工修改都會在下次重跑時被蓋掉。後台要能編輯內容，
資料就必須改為「以檔案為準」，鏡像萃取則退回成一次性的初始匯入。

本程式只需執行一次。執行後：
  - content/ 底下的檔案成為唯一的資料來源
  - scripts/extract_products.py 與 build_catalog.py 僅供查閱舊資料，
    不再參與日常建置

用法：
    python3 scripts/migrate_to_content.py
"""
import json
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CATALOG = ROOT / "src" / "data" / "catalog.json"
CONTENT = ROOT / "content"


def image_path(src: str) -> str:
    """舊站路徑 /upload/1/126-1b.jpg?t=… → 新站路徑 /images/products/1/126-1b.jpg"""
    clean = src.split("?")[0]
    return "/images/products/" + re.sub(r"^/upload/", "", clean)


def main() -> int:
    if not CATALOG.exists():
        print(f"找不到 {CATALOG}", file=sys.stderr)
        return 1

    if (CONTENT / "products").exists():
        print("content/products 已存在，表示已經轉換過了。")
        print("若要重新轉換，請先自行備份並刪除 content/ 目錄。")
        return 1

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))

    (CONTENT / "products").mkdir(parents=True, exist_ok=True)
    (CONTENT / "news").mkdir(parents=True, exist_ok=True)

    # 分類樹：後台可調整名稱與排序，但 legacy 欄位供轉址對照，不可刪
    categories = []
    for order, cat in enumerate(catalog["categories"], start=1):
        categories.append({
            "slug": cat["slug"],
            "name": cat["name"],
            "order": order * 10,
            "published": True,
            "legacy_m": cat.get("legacy_m", ""),
            "children": [
                {
                    "slug": sub["slug"],
                    "name": sub["name"],
                    "order": i * 10,
                    "published": True,
                    "legacy_m2": sub.get("legacy_m2", ""),
                }
                for i, sub in enumerate(cat["children"], start=1)
            ],
        })
    (CONTENT / "categories.json").write_text(
        json.dumps(categories, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    for order, product in enumerate(catalog["products"], start=1):
        record = {
            "slug": product["slug"],
            "name": product["name"],
            "code": product["code"],
            "category": product["category"],
            "subcategory": product["subcategory"],
            # 下架後網站不顯示，但舊網址仍會導向所屬分類而非 404
            "published": True,
            "order": order * 10,
            "images": [image_path(src) for src in product["images"]],
            # SDS 與說明書，由後台上傳後填入
            "documents": [],
            "spec_html": product["spec_html"],
            # 轉址對照用，請勿手動修改
            "legacy": product["legacy"],
        }
        path = CONTENT / "products" / f'{product["slug"]}.json'
        path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # 公司簡介等靜態頁文字
    pages = json.loads((ROOT / "src" / "data" / "pages.json").read_text(encoding="utf-8"))
    (CONTENT / "about.json").write_text(
        json.dumps(
            {
                "title": "公司簡介",
                "body": pages["about"]["text"],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"分類：{len(categories)} 大類 → content/categories.json")
    print(f"產品：{len(catalog['products'])} 項 → content/products/*.json")
    print("公司簡介 → content/about.json")
    print("\n此後 content/ 即為唯一資料來源，鏡像萃取程式不再參與建置。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
