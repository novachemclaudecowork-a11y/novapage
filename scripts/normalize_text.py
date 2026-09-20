#!/usr/bin/env python3
"""
把產品說明裡全形的英文字母與阿拉伯數字整理為半形。

舊站的內容是用早期網頁編輯器輸入的，英數字都存成全形
（「ＢＳ－００７」「１５０～２００目」），在現代瀏覽器上不易閱讀，
搜尋引擎也不會把「ＢＳ－００７」與使用者輸入的「BS-007」視為同一個詞。

⚠️ 只轉換英文字母與數字。中文標點（，：（）、．～）一律保留原樣——
這些在中文行文中本來就該是全形，轉成半形會讓內文看起來像編碼壞掉。
全形空白也保留，舊站用它對齊「〔用　　途〕」這類標題。

預設只產出對照表供確認，加上 --apply 才會實際寫入。

用法：
    python3 scripts/normalize_text.py            # 預覽將變更的內容
    python3 scripts/normalize_text.py --apply    # 實際套用
"""
import json
import pathlib
import re
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
CATALOG = ROOT / "src" / "data" / "catalog.json"

# 全形數字 ０-９、大寫 Ａ-Ｚ、小寫 ａ-ｚ
FULLWIDTH_ALNUM = re.compile("[０-９Ａ-Ｚａ-ｚ]")

# 產品編號中的連字號與井號，僅在緊鄰英數字時轉換：
# 「ＢＳ－００７」→「BS-007」、「＃２洗版劑」→「#2洗版劑」。
# 中文語句中的全形符號不受影響。
CODE_HYPHEN = re.compile("(?<=[0-9A-Za-z])－(?=[0-9A-Za-z])")
CODE_HASH = re.compile("＃(?=[0-9A-Za-z])")

FIELDS = ("name", "code", "spec_text", "spec_html")


def normalize(text: str) -> str:
    text = FULLWIDTH_ALNUM.sub(lambda m: unicodedata.normalize("NFKC", m.group()), text)
    # 英數轉完才處理連字號，此時產品編號兩側已是半形
    text = CODE_HYPHEN.sub("-", text)
    return CODE_HASH.sub("#", text)


def main() -> int:
    apply = "--apply" in sys.argv
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))

    changed_fields = 0
    changed_products: set[str] = set()
    preview: list[tuple[str, list[tuple[str, str]]]] = []

    for product in catalog["products"]:
        lines: list[tuple[str, str]] = []
        for field in FIELDS:
            before = product.get(field, "")
            after = normalize(before)
            if before == after:
                continue
            changed_fields += 1
            changed_products.add(product["name"])
            if apply:
                product[field] = after
            # spec_html 的差異與 spec_text 重複，預覽時只看純文字
            if field == "spec_html":
                continue
            if field in ("name", "code"):
                lines.append((before, after))
            else:
                lines += [
                    (b, a) for b, a in zip(before.split("\n"), after.split("\n")) if b != a
                ]
        if lines:
            preview.append((product["name"], lines))

    if not changed_fields:
        print("沒有需要整理的全形英數字。")
        return 0

    print(f"將變更 {changed_fields} 個欄位，涵蓋 {len(changed_products)} 項產品\n")
    for name, lines in preview:
        print(f"【{name}】")
        for before, after in lines[:5]:
            print(f"    原：{before}")
            print(f"    改：{after}")
        if len(lines) > 5:
            print(f"    …另有 {len(lines) - 5} 行")
        print()

    if apply:
        CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"✅ 已套用並寫回 {CATALOG.relative_to(ROOT)}")
    else:
        print("以上為預覽。確認無誤後執行：python3 scripts/normalize_text.py --apply")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
