# 一次性匯入工具（已完成任務，保留備查）

這裡的程式是當初把舊站（H3 B2B System）內容搬進新站時用的，
**現在的網站建置完全不會用到它們**。

新站的資料來源是專案根目錄的 `content/`，由後台直接編輯。
若在這裡重跑任何程式，產生的檔案也不會影響網站——請不要用它們覆蓋 `content/`。

## 當初的流程

```
site-mirror/              舊站完整鏡像
    ↓  extract_products.py      以 (m, m2, pg) 為鍵萃取產品
    ↓  build_catalog.py         整理分類樹、去重、修正錯字
    ↓  normalize_text.py        全形英數字轉半形
    ↓  prepare_assets.py        複製圖片、取出靜態頁文字
    ↓  migrate_to_content.py    轉為 content/ 底下的可編輯檔案
content/                  ← 從此成為唯一資料來源
```

`audit_coverage.py` 是當初用來稽核鏡像完整性的，
`mirror-site.sh` 是抓取舊站的指令。

## 什麼情況下才會再用到

- 需要回頭查舊站某個頁面原本長什麼樣
- 發現當初漏匯了某些內容，要從 `site-mirror/` 補撈

除此之外都不需要碰。舊站的技術分析與這些程式的設計考量，
見 [`../../docs/鏡像分析報告.md`](../../docs/鏡像分析報告.md)。
