#!/usr/bin/env python3
"""
比對「分類列表頁列出的產品」與「鏡像實際抓到的產品明細頁」，
找出鏡像遺漏的產品，作為補抓清單。

用法：python3 scripts/audit_coverage.py
"""
import json
import pathlib
import re
from urllib.parse import parse_qs, urlparse

from bs4 import BeautifulSoup

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIRROR = ROOT / "site-mirror" / "www.novananoinks.com.tw"


def read(p: pathlib.Path) -> str:
    return p.read_bytes().decode("utf-8", "replace")


def main() -> int:
    listed: dict[str, dict] = {}      # 列表頁宣告存在的產品
    categories: dict[str, str] = {}   # pd_type -> 分類名稱

    for path in sorted(MIRROR.glob("product.*")):
        soup = BeautifulSoup(read(path), "lxml")

        path_div = soup.find("div", class_="Path")
        if path_div:
            names = [f.get_text(strip=True) for f in path_div.find_all("font")]
            names = [n for n in names if n and n not in {"◎", ">"}]
            qs = parse_qs(path.name.split("@", 1)[1]) if "@" in path.name else {}
            if "pd_type" in qs and len(names) > 1:
                categories[qs["pd_type"][0]] = names[-1]

        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "view." not in href:
                continue
            qs = parse_qs(urlparse(href).query)
            pid = qs.get("id", [None])[0]
            if not pid:
                continue
            label = a.get_text(strip=True)
            entry = listed.setdefault(pid, {"id": pid, "labels": set(), "hrefs": set()})
            if label:
                entry["labels"].add(label)
            entry["hrefs"].add(href)

    mirrored = set()
    for path in MIRROR.glob("view.*"):
        if "@" not in path.name:
            continue
        qs = parse_qs(path.name.split("@", 1)[1])
        if "id" in qs and BeautifulSoup(read(path), "lxml").find("table", id="PdTable"):
            mirrored.add(qs["id"][0])

    missing = sorted(set(listed) - mirrored, key=int)
    extra = sorted(mirrored - set(listed), key=int)

    print(f"分類列表頁共列出產品：{len(listed)} 項")
    print(f"鏡像實際抓到明細頁：{len(mirrored)} 項")
    print(f"已辨識分類：{len(categories)} 個\n")

    if missing:
        print(f"⚠️  遺漏 {len(missing)} 項產品明細頁，需補抓：")
        for pid in missing:
            labels = ", ".join(sorted(listed[pid]["labels"])) or "(列表頁未顯示名稱)"
            print(f"  id={pid:>4}  {labels}")
        out = ROOT / "site-mirror" / "缺漏清單.txt"
        out.write_text(
            "\n".join(
                f"https://www.novananoinks.com.tw{sorted(listed[p]['hrefs'])[0]}"
                if sorted(listed[p]["hrefs"])[0].startswith("/")
                else f"https://www.novananoinks.com.tw/{sorted(listed[p]['hrefs'])[0]}"
                for p in missing
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"\n補抓網址已寫入：{out.relative_to(ROOT)}")
    else:
        print("✅ 沒有遺漏，列表頁列出的產品全數抓到")

    if extra:
        print(f"\n（另有 {len(extra)} 項明細頁未出現在任何列表頁：{', '.join(extra)}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
