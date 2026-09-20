#!/usr/bin/env python3
"""
從 site-mirror/ 的鏡像檔萃取產品資料。

⚠️ 舊站（H3 B2B System）的重要特性：
網址中的 `id` 參數其實**被伺服器忽略**，實際顯示哪一項產品，
是由「分類 `m` + 分頁序號 `pg`」決定的。
例如 view.html?id=999&m=1&pg=5 與 view.html?id=123&m=1&pg=5
會回傳完全相同的內容（網印油墨的第 5 項）。

因此本程式以 (m, m2, pg) 作為產品的唯一鍵，而非 id。
若誤用 id 去重，會把不同產品誤判為重複、並遺漏大量產品。

用法：
    python3 scripts/extract_products.py
輸出：
    src/data/products.json      產品資料（依分類與頁次排序）
    src/data/legacy-urls.json   舊網址 → (m, m2, pg) 對照，供 301 轉址使用
"""
import json
import pathlib
import re
import sys
from urllib.parse import parse_qs

from bs4 import BeautifulSoup

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIRROR = ROOT / "site-mirror" / "www.novananoinks.com.tw"
OUT_DIR = ROOT / "src" / "data"

# 首頁最新商品區塊（pdid=HomeNew）使用自己的一套排序，
# 與分類頁的 pg 序號不相容，納入會造成錯誤配對。
EXCLUDED_PDID = {"HomeNew"}


def read(path: pathlib.Path) -> str:
    return path.read_bytes().decode("utf-8", "replace")


def params_of(filename: str) -> dict:
    """由 wget 存下的檔名（view.html@id=127&m=1&pg=5）還原查詢參數。"""
    if "@" not in filename:
        return {}
    return {
        k: v[0]
        for k, v in parse_qs(filename.split("@", 1)[1], keep_blank_values=True).items()
    }


def breadcrumb(soup: BeautifulSoup) -> list[str]:
    """麵包屑位於 div.Path：◎ 首頁 > 網印油墨 > PU彈性網印油墨"""
    path = soup.find("div", class_="Path")
    if path is None:
        return []
    parts = [f.get_text(strip=True) for f in path.find_all("font")]
    return [p for p in parts if p and p not in {"◎", ">"}]


def product_images(soup: BeautifulSoup) -> list[str]:
    """產品照。主圖為 img#photo，另收集 /upload/ 底下的其他產品圖。"""
    imgs: list[str] = []
    main = soup.find("img", id="photo")
    if main and main.get("src"):
        imgs.append(main["src"])
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if re.match(r"/upload/\d+/", src) and src not in imgs:
            imgs.append(src)
    return imgs


def parse_product(path: pathlib.Path) -> dict | None:
    soup = BeautifulSoup(read(path), "lxml")
    table = soup.find("table", id="PdTable")
    if table is None:
        return None
    name_tag = table.find("font", class_="PdTitleName")
    if name_tag is None:
        return None

    # 欄位標籤（產品編號：）與其值同在一個 <td>，標籤之後的文字即為值
    fields: dict[str, str] = {}
    for label in table.find_all("font", class_="PdTitle"):
        key = label.get_text(strip=True).rstrip("：:")
        td = label.find_parent("td")
        value = td.get_text(" ", strip=True).replace(label.get_text(strip=True), "", 1).strip()
        if value:
            fields[key] = value

    spec = table.find("td", class_="ProductSpec")
    crumbs = breadcrumb(soup)
    return {
        "name": name_tag.get_text(strip=True),
        "code": fields.get("產品編號", ""),
        "fields": {k: v for k, v in fields.items() if k != "產品編號"},
        "breadcrumb": crumbs,
        "spec_html": spec.decode_contents().strip() if spec else "",
        "spec_text": spec.get_text("\n", strip=True) if spec else "",
        "images": product_images(soup),
    }


def main() -> int:
    if not MIRROR.is_dir():
        print(f"找不到鏡像目錄：{MIRROR}", file=sys.stderr)
        return 1

    by_key: dict[tuple, dict] = {}
    legacy: dict[str, dict] = {}
    conflicts: list[str] = []

    for path in sorted(MIRROR.glob("view.*")):
        qs = params_of(path.name)
        m, pg = qs.get("m"), qs.get("pg")
        if not m or not pg or qs.get("pdid") in EXCLUDED_PDID:
            continue
        key = (m, qs.get("m2", ""), int(pg))

        parsed = parse_product(path)
        if parsed is None:
            continue

        legacy["/" + path.name.replace("@", "?")] = {
            "m": key[0], "m2": key[1], "pg": key[2], "name": parsed["name"],
        }

        existing = by_key.get(key)
        if existing is None:
            parsed["m"], parsed["m2"], parsed["pg"] = key
            by_key[key] = parsed
        elif existing["name"] != parsed["name"]:
            conflicts.append(f"{key} → {existing['name']} vs {parsed['name']}")
        else:
            # 同一產品的另一個網址變體：補齊較完整的欄位
            if len(parsed["spec_text"]) > len(existing["spec_text"]):
                existing.update(spec_html=parsed["spec_html"], spec_text=parsed["spec_text"])
            for img in parsed["images"]:
                if img not in existing["images"]:
                    existing["images"].append(img)

    # 分類列表頁（m2 為空）代表該主分類的完整產品清單
    products = [p for k, p in sorted(by_key.items(), key=lambda kv: (int(kv[0][0]), kv[0][2]))
                if k[1] == ""]
    sub_listings = {k: p for k, p in by_key.items() if k[1] != ""}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "products.json").write_text(
        json.dumps(products, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT_DIR / "legacy-urls.json").write_text(
        json.dumps(legacy, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )

    print(f"產品數：{len(products)}")
    print(f"子分類頁另收錄：{len(sub_listings)} 筆歸屬資訊")
    print(f"舊網址數：{len(legacy)}（將用於 301 轉址）")
    if conflicts:
        print(f"\n⚠️  鍵值衝突 {len(conflicts)} 筆（同一 (m,m2,pg) 卻是不同產品）：")
        for c in conflicts[:10]:
            print("   ", c)

    by_main: dict[str, list[str]] = {}
    for p in products:
        cat = p["breadcrumb"][1] if len(p["breadcrumb"]) > 2 else "(未分類)"
        by_main.setdefault(cat, []).append(p["name"])
    print("\n分類分布：")
    for cat, names in by_main.items():
        print(f"  {len(names):3d}  {cat}")

    no_spec = [p["name"] for p in products if not p["spec_text"]]
    no_img = [p["name"] for p in products if not p["images"]]
    if no_spec:
        print(f"\n⚠️  無產品說明：{len(no_spec)} 項 — {', '.join(no_spec)}")
    if no_img:
        print(f"⚠️  無產品照：{len(no_img)} 項 — {', '.join(no_img)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
