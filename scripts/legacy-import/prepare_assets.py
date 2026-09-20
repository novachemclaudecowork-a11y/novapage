#!/usr/bin/env python3
"""
把鏡像檔裡的靜態頁文字與圖片素材，轉成新站可直接使用的形式。

用法：
    python3 scripts/prepare_assets.py
輸出：
    src/data/pages.json        公司簡介、聯絡我們等靜態頁內容
    public/images/products/    產品照片（檔名已去除 ?t= 快取參數）
    public/images/brand/       Logo 等品牌素材
"""
import json
import pathlib
import re
import shutil

from bs4 import BeautifulSoup

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIRROR = ROOT / "site-mirror" / "www.novananoinks.com.tw"
OUT_DATA = ROOT / "src" / "data"
OUT_IMG = ROOT / "public" / "images"

# 舊站的靜態頁。p.asp?id=N 的 N 對應主選單上的項目。
STATIC_PAGES = {
    "about": {"legacy": "page/p.asp@id=1", "title": "公司簡介", "nav": "公司簡介"},
    "contact": {"legacy": "page/p.asp@id=7", "title": "聯絡我們", "nav": "聯絡我們"},
    "support": {"legacy": "page/p.asp@id=10", "title": "技術支援", "nav": "技術支援"},
    "videos": {"legacy": "page/p.asp@id=11", "title": "影片欣賞", "nav": "影片欣賞"},
}

# 版面框架用的容器，內容萃取時要排除
CHROME_IDS = {"LeftSlidingMenu", "google_translate_element2"}
CHROME_CLASSES = {"RwdMenu", "Path", "ItemControl", "site-header", "site-footer"}


def read(p: pathlib.Path) -> str:
    return p.read_bytes().decode("utf-8", "replace")


def strip_chrome(soup: BeautifulSoup) -> None:
    # 先整份收集再刪除：decompose() 會使後續走訪到的節點失效
    doomed = list(soup(["script", "style", "noscript"]))
    for t in soup.find_all(True):
        if t.get("id") in CHROME_IDS or CHROME_CLASSES & set(t.get("class") or []):
            doomed.append(t)
    for t in doomed:
        if t.parent is not None:
            t.decompose()


def template_lines() -> set[str]:
    """所有頁面共有的版面文字（頁首、頁尾、選單），內容比對時要扣掉。"""
    soup = BeautifulSoup(read(MIRROR / "index.html"), "lxml")
    strip_chrome(soup)
    return {l.strip() for l in soup.get_text("\n").split("\n") if l.strip()}


def extract_content(path: pathlib.Path, boilerplate: set[str]) -> dict:
    soup = BeautifulSoup(read(path), "lxml")
    strip_chrome(soup)

    # 內容區是「純文字量最大且不含巢狀容器」的那一格
    best, best_len = None, 0
    for t in soup.find_all(["div", "td"]):
        if t.find(["div", "td"]):
            continue
        text = t.get_text(" ", strip=True)
        if len(text) > best_len:
            best, best_len = t, len(text)

    lines = [l.strip() for l in soup.get_text("\n").split("\n") if l.strip()]
    unique = [l for l in lines if l not in boilerplate]

    return {
        "html": best.decode_contents().strip() if best is not None else "",
        "text": best.get_text("\n", strip=True) if best is not None else "",
        "unique_lines": unique,
    }


def copy_images() -> int:
    """複製產品照與品牌素材，並去除檔名上的 ?t= 快取參數。"""
    count = 0
    products_dir = OUT_IMG / "products"
    brand_dir = OUT_IMG / "brand"
    products_dir.mkdir(parents=True, exist_ok=True)
    brand_dir.mkdir(parents=True, exist_ok=True)

    for src in (MIRROR / "upload").rglob("*"):
        if not src.is_file():
            continue
        clean = re.sub(r"@t=\d+$", "", src.name)
        if not re.search(r"\.(jpg|jpeg|png|gif|webp)$", clean, re.I):
            continue
        rel = src.parent.relative_to(MIRROR / "upload")
        dest = products_dir / rel / clean
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            shutil.copy2(src, dest)
            count += 1

    for name in ["logo_s.png", "banner.gif"]:
        matches = list((MIRROR / "home" / "chinese").glob(name + "*"))
        if matches:
            shutil.copy2(matches[0], brand_dir / name)
            count += 1
    return count


def main() -> int:
    boilerplate = template_lines()
    pages = {}
    for key, meta in STATIC_PAGES.items():
        path = MIRROR / meta["legacy"]
        if not path.exists():
            pages[key] = {**meta, "missing": True}
            continue
        pages[key] = {**meta, **extract_content(path, boilerplate)}

    OUT_DATA.mkdir(parents=True, exist_ok=True)
    (OUT_DATA / "pages.json").write_text(
        json.dumps(pages, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    copied = copy_images()
    print(f"靜態頁：{len(pages)} 頁")
    for key, page in pages.items():
        if page.get("missing"):
            print(f"  ⚠️  {page['title']}：鏡像中不存在")
        else:
            print(f"  ✅ {page['title']}：內容 {len(page['text'])} 字")
    print(f"\n複製圖片：{copied} 個檔案 → public/images/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
