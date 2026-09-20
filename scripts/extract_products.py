#!/usr/bin/env python3
"""
從 site-mirror/ 的鏡像檔萃取產品資料，輸出為結構化 JSON。

舊站（H3 B2B System）的同一個產品會有多個網址變體
（?pg= 分頁、?pd_type= 分類、?pdid= 來源等），本程式以產品 id 去重，
並保留所有出現過的舊網址，供日後製作 301 轉址對照表使用。

用法：
    python3 scripts/extract_products.py
輸出：
    src/data/products.json      產品資料
    src/data/legacy-urls.json   舊網址 → 產品 id 對照
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


def read(path: pathlib.Path) -> str:
    return path.read_bytes().decode("utf-8", "replace")


def params_of(filename: str) -> dict:
    """由 wget 存下的檔名（view.html@id=127&pd_type=1...）還原查詢參數。"""
    if "@" not in filename:
        return {}
    return {k: v[0] for k, v in parse_qs(filename.split("@", 1)[1]).items()}


def breadcrumb(soup: BeautifulSoup) -> list[str]:
    """麵包屑位於 div.Path：◎ 首頁 > 網印油墨 > PU彈性網印油墨"""
    path = soup.find("div", class_="Path")
    if path is None:
        return []
    parts = [f.get_text(strip=True) for f in path.find_all("font")]
    return [p for p in parts if p and p not in {"◎", ">"}]


def category_link(soup: BeautifulSoup) -> str:
    """麵包屑中分類的舊網址，用於對應到分類頁。"""
    path = soup.find("div", class_="Path")
    if path is None:
        return ""
    links = path.find_all("a")
    return links[1].get("href", "") if len(links) > 1 else ""


def product_images(soup: BeautifulSoup) -> list[str]:
    """產品照。主圖為 img#photo，另收集 /upload/ 底下的其他產品圖。"""
    imgs: list[str] = []
    main = soup.find("id_placeholder")
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

    # 欄位標籤（產品編號：）與其值在同一個 <td> 內，標籤之後的文字即為值
    fields: dict[str, str] = {}
    for label in table.find_all("font", class_="PdTitle"):
        key = label.get_text(strip=True).rstrip("：:")
        td = label.find_parent("td")
        value = td.get_text(" ", strip=True).replace(label.get_text(strip=True), "", 1).strip()
        if value:
            fields[key] = value

    spec = table.find("td", class_="ProductSpec")

    crumbs = breadcrumb(soup)
    # crumbs = [首頁, 分類, 產品名]
    return {
        "name": name_tag.get_text(strip=True),
        "code": fields.get("產品編號", ""),
        "fields": {k: v for k, v in fields.items() if k != "產品編號"},
        "category": crumbs[1] if len(crumbs) > 2 else "",
        "category_legacy_url": category_link(soup),
        "breadcrumb": crumbs,
        "spec_html": spec.decode_contents().strip() if spec else "",
        "spec_text": spec.get_text("\n", strip=True) if spec else "",
        "images": product_images(soup),
        "title": soup.title.get_text(strip=True) if soup.title else "",
    }


def main() -> int:
    if not MIRROR.is_dir():
        print(f"找不到鏡像目錄：{MIRROR}", file=sys.stderr)
        return 1

    products: dict[str, dict] = {}
    legacy: dict[str, str] = {}
    skipped = 0

    for path in sorted(MIRROR.glob("view.*")):
        pid = params_of(path.name).get("id")
        if not pid:
            continue

        # 記錄每個舊網址，供 301 轉址對照
        legacy["/" + path.name.replace("@", "?")] = pid

        parsed = parse_product(path)
        if parsed is None:
            skipped += 1
            continue

        parsed["id"] = pid
        # 同一產品有多個變體時擇優保留。
        # 透過首頁進入的變體，麵包屑會顯示「首頁商品」而非真正的分類，
        # 故優先採用帶有真實分類的變體，其次才比較說明的完整度。
        def score(rec: dict) -> tuple[int, int]:
            cat = rec.get("category", "")
            real_category = bool(cat) and cat != "首頁商品"
            return (int(real_category), len(rec["spec_text"]))

        existing = products.get(pid)
        if existing is None or score(parsed) > score(existing):
            products[pid] = parsed

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ordered = [products[k] for k in sorted(products, key=int)]
    (OUT_DIR / "products.json").write_text(
        json.dumps(ordered, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT_DIR / "legacy-urls.json").write_text(
        json.dumps(legacy, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )

    print(f"產品數：{len(ordered)}")
    print(f"舊網址數：{len(legacy)}（將用於 301 轉址）")
    if skipped:
        print(f"無法解析而略過：{skipped} 個檔案")

    cats: dict[str, int] = {}
    for p in ordered:
        cats[p["category"] or "(未分類)"] = cats.get(p["category"] or "(未分類)", 0) + 1
    print("\n分類分布：")
    for name, count in sorted(cats.items(), key=lambda kv: -kv[1]):
        print(f"  {count:3d}  {name}")

    missing = [p["id"] for p in ordered if not p["spec_text"]]
    if missing:
        print(f"\n⚠️  無產品說明的 id：{', '.join(missing)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
