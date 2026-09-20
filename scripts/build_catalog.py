#!/usr/bin/env python3
"""
把鏡像檔轉換為新站使用的正規化型錄資料。

舊站（H3 B2B System）為了讓同一項產品能出現在多個子分類下，
會把整筆產品資料複製成多筆。本程式將其還原為
「一項產品一筆資料，可同時歸屬多個分類」的結構。

用法：
    python3 scripts/build_catalog.py
輸出：
    src/data/catalog.json    分類樹 + 去重後的產品 + 分類歸屬
    src/data/redirects.json  舊網址 → 新網址對照（301 轉址用）
"""
import json
import pathlib
import re
from urllib.parse import parse_qs, urlparse

from bs4 import BeautifulSoup

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIRROR = ROOT / "site-mirror" / "www.novananoinks.com.tw"
OUT = ROOT / "src" / "data"

# 原站標題的錯字，經貴公司確認後修正。
# 格式：錯誤名稱 -> 正確名稱
NAME_CORRECTIONS = {
    "TI布熱轉往印油墨": "TI布熱轉印油墨",
}

# 中文分類／產品對應的英文網址代稱。
# 新增產品時在此補一筆即可；未列出者會退回使用 item-<id> 形式。
SLUGS = {
    # 主分類
    "網印油墨": "screen-inks",
    "稀釋劑&洗版劑": "thinners-cleaners",
    "製版資材": "platemaking",
    "醋酸丁酸纖維素 CAB-381-0.5": "cab-381",
    "貝星五極中性筆墨水": "pen-inks",
    # 網印油墨子分類
    "MPV通用油墨": "mpv",
    "PET商標貼紙油墨": "pet-label",
    "PET水轉自行車標油墨": "pet-water-transfer",
    "410 刮刮樂網印油墨": "410-scratch",
    "PD金屬玻璃網印油墨": "pd-metal-glass",
    "CP通用色膏": "cp-color-paste",
    "PU彈性網印油墨": "pu-elastic",
    "CW水性油墨": "cw-waterbased",
    "TI布熱轉網印油墨": "ti-heat-transfer",
    "TI布熱轉印油墨": "ti-heat-transfer",
    "RI擦壓轉印油墨": "ri-rub-transfer",
    "PP網印油墨": "pp",
    "PP 油墨": "pp",
    "OT耐噴砂網印油墨": "ot-sandblast",
    "OT-031耐噴砂網印油墨": "ot-sandblast",
    "矽膠油墨": "silicone",
    "金銀漿、中細閃、螢光粉": "metallic-glitter",
    "MPV通用塑膠油墨": "mpv",
    # 稀釋劑 & 洗版劑子分類
    "BS 稀釋劑": "bs-thinner",
    "油墨專用稀釋劑": "bs-thinner",
    "SW 洗版劑": "sw-cleaner",
    "PP 處理劑": "pp-primer",
    "PP處理劑": "pp-primer",
    "防塞劑": "anti-clog",
    "擦拭劑": "wiping-agent",
    "消泡劑/助劑": "defoamer",
    "暫凝膏": "thickener",
    "消光膏": "matting-paste",
    "橡膠處理劑": "rubber-primer",
    # 製版資材子分類
    "感光乳劑": "emulsion",
    "高解度感光乳劑": "emulsion",
    "芳香除墨劑": "ink-remover",
    "除鬼影劑": "ghost-remover",
    "剝膜粉/膏": "stencil-remover",
    "脫脂劑": "degreaser",
    "補版膠": "block-out",
    "補邊劑": "edge-sealer",
    "單液型補強液": "hardener",
    "鋁框接著膠": "frame-adhesive",
    "其他資材": "other-supplies",
    "刮刀/刮膠": "squeegee",
    "調墨刀/調油刀/油墨攪拌刀/抹刀": "spatula",
    "油墨專用手膏洗手膏": "hand-cleaner",
    "醋酸丁酸纖維素 CAB-381-0.5": "cab-381",
    "貝星五極中性筆墨水": "wuji-pen-ink",
}


def read(p: pathlib.Path) -> str:
    return p.read_bytes().decode("utf-8", "replace")


def slugify(name: str, fallback: str) -> str:
    if name in SLUGS:
        return SLUGS[name]
    ascii_slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return ascii_slug or fallback


def parse_category_tree(soup: BeautifulSoup) -> list[dict]:
    """由左側選單 div#LeftSlidingMenu 取得 4 大類 / 32 子分類。"""
    menu = soup.find("div", id="LeftSlidingMenu")
    tree: list[dict] = []
    for ul in menu.find_all("ul", recursive=False):
        for li in ul.find_all("li", recursive=False):
            a = li.find("a")
            if not a:
                continue
            name = a.get_text(strip=True)
            qs = parse_qs(urlparse(a.get("href", "")).query)
            main = {
                "name": name,
                "slug": slugify(name, "cat"),
                "legacy_m": qs.get("m", [""])[0],
                "legacy_pd_type": qs.get("pd_type", [""])[0],
                "children": [],
            }
            sub_ul = li.find("ul")
            if sub_ul:
                for sli in sub_ul.find_all("li"):
                    sa = sli.find("a")
                    if not sa:
                        continue
                    sname = sa.get_text(strip=True)
                    sqs = parse_qs(urlparse(sa.get("href", "")).query)
                    main["children"].append({
                        "name": sname,
                        "slug": slugify(sname, "sub"),
                        "legacy_m2": sqs.get("m2", [""])[0],
                        "legacy_pd_type": sqs.get("pd_type", [""])[0],
                    })
            tree.append(main)
    return tree


def sub_listing_names() -> dict[str, set[str]]:
    """由子分類頁（m2 不為空）取得 m2 -> {產品名稱}。

    舊站只有「其他資材」(m2=159) 這個子分類真的掛了產品，
    其餘子分類頁皆為空殼。
    """
    products = json.loads((OUT / "products.json").read_text(encoding="utf-8"))
    del products  # 僅為表明資料來源；實際改讀鏡像中的子分類頁
    names: dict[str, set[str]] = {}
    for path in MIRROR.glob("view.*"):
        if "@" not in path.name:
            continue
        qs = parse_qs(path.name.split("@", 1)[1], keep_blank_values=True)
        m2 = qs.get("m2", [""])[0]
        if not m2 or qs.get("pdid", [""])[0] == "HomeNew":
            continue
        soup = BeautifulSoup(read(path), "lxml")
        table = soup.find("table", id="PdTable")
        if table is None:
            continue
        tag = table.find("font", class_="PdTitleName")
        if tag:
            names.setdefault(m2, set()).add(tag.get_text(strip=True))
    return names


def main() -> int:
    products = json.loads((OUT / "products.json").read_text(encoding="utf-8"))
    home = BeautifulSoup(read(MIRROR / "index.html"), "lxml")
    tree = parse_category_tree(home)
    sub_names = sub_listing_names()

    # 舊站的左側選單與「產品介紹」頁都沒有列出「貝星五極中性筆墨水」(m=5)，
    # 只能靠直接輸入網址才進得去。公司簡介明載此為自有品牌，
    # 顯然是漏掛而非停售，故於新站補回為主分類。
    if not any(main["legacy_m"] == "5" for main in tree):
        tree.append({
            "name": "貝星五極中性筆墨水",
            "slug": "pen-inks",
            "legacy_m": "5",
            "legacy_pd_type": "5",
            "children": [],
            "note": "舊站選單漏列，新站補回",
        })

    main_by_m = {main["legacy_m"]: main for main in tree}
    sub_by_slug = {s["slug"]: (main, s) for main in tree for s in main["children"]}
    sub_by_m2 = {s["legacy_m2"]: (main, s) for main in tree for s in main["children"]}

    items: list[dict] = []
    used_slugs: dict[str, int] = {}

    for p in products:
        name = NAME_CORRECTIONS.get(p["name"], p["name"])
        slug = slugify(name, f'item-{p["m"]}-{p["pg"]}')
        used_slugs[slug] = used_slugs.get(slug, 0) + 1
        if used_slugs[slug] > 1:
            slug = f"{slug}-{used_slugs[slug]}"

        main = main_by_m.get(p["m"])
        # 子分類：優先看名稱是否對應到選單上的某個子分類
        sub = None
        hit = sub_by_slug.get(slugify(name, ""))
        if hit and hit[0] is main:
            sub = hit[1]

        items.append({
            "slug": slug,
            "name": name,
            "code": p["code"],
            "spec_html": p["spec_html"],
            "spec_text": p["spec_text"],
            "images": p["images"],
            "category": main["slug"] if main else "",
            "subcategory": sub["slug"] if sub else None,
            "legacy": {"m": p["m"], "pg": p["pg"]},
        })

    # 「其他資材」等真的掛了產品的子分類，依名稱補上歸屬
    by_name = {it["name"]: it for it in items}
    for m2, names in sub_names.items():
        entry = sub_by_m2.get(m2)
        if entry is None:
            continue
        _, sub = entry
        for nm in names:
            it = by_name.get(NAME_CORRECTIONS.get(nm, nm))
            if it and it["subcategory"] is None:
                it["subcategory"] = sub["slug"]

    # 統計每個子分類的產品數，找出真正沒有內容的產品線
    counts: dict[str, int] = {}
    for it in items:
        if it["subcategory"]:
            counts[it["subcategory"]] = counts.get(it["subcategory"], 0) + 1

    empty_subs = []
    for main in tree:
        for sub in main["children"]:
            sub["product_count"] = counts.get(sub["slug"], 0)
            if sub["product_count"] == 0:
                empty_subs.append({"主分類": main["name"], "產品線": sub["name"], "slug": sub["slug"]})

    # 有產品但選單上沒有對應子分類的品項
    orphans = [it["name"] for it in items if it["subcategory"] is None]

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "catalog.json").write_text(
        json.dumps({"categories": tree, "products": items}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (OUT / "missing-product-lines.json").write_text(
        json.dumps(empty_subs, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 舊網址 → 新網址，供上線時設定 301 轉址
    legacy = json.loads((OUT / "legacy-urls.json").read_text(encoding="utf-8"))
    slug_by_key = {(it["legacy"]["m"], it["legacy"]["pg"]): it["slug"] for it in items}
    redirects = {}
    for old_url, info in legacy.items():
        slug = slug_by_key.get((info["m"], info["pg"]))
        if slug:
            redirects[old_url] = f"/products/{slug}/"
    (OUT / "redirects.json").write_text(
        json.dumps(redirects, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )

    print(f"分類：{len(tree)} 大類 / {sum(len(m['children']) for m in tree)} 子分類")
    print(f"產品：{len(items)} 項")
    print(f"轉址對照：{len(redirects)} / {len(legacy)} 筆舊網址")

    print("\n各主分類產品數：")
    for main in tree:
        n = sum(1 for it in items if it["category"] == main["slug"])
        print(f"  {n:3d}  {main['name']}")

    if orphans:
        print(f"\n選單上沒有對應產品線的產品（{len(orphans)} 項）：")
        for nm in orphans:
            print(f"  ・{nm}")

    print(f"\n選單上有、但沒有任何產品的產品線（{len(empty_subs)} 個）：")
    for e in empty_subs:
        print(f"  ・{e['主分類']} / {e['產品線']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
