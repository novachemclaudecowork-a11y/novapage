#!/usr/bin/env bash
#
# 把現行的 www.novananoinks.com.tw 完整鏡像到 site-mirror/
#
# 用法：
#   bash scripts/mirror-site.sh
#
# 請在「有對外網路的電腦」上執行（例如你自己的筆電），
# 不要在受限的雲端環境中執行。
#
set -euo pipefail

SITE="https://www.novananoinks.com.tw/"
OUT="site-mirror"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

if ! command -v wget >/dev/null 2>&1; then
  echo "找不到 wget。請先安裝："
  echo "  Mac：   brew install wget"
  echo "  Ubuntu：sudo apt install wget"
  echo "  Windows：建議改用 WinHTTrack（見 docs/鏡像操作指南.md）"
  exit 1
fi

echo "開始鏡像 ${SITE}"
echo "輸出目錄：${OUT}/"
echo "（每次請求間隔約 1 秒，以免造成對方主機負擔；請耐心等候）"
echo

# --mirror         遞迴下載整站，不限深度
# --page-requisites 一併抓取 CSS / JS / 圖片
# --no-parent      不往上層目錄爬
# -e robots=off    忽略 robots.txt（這是我們自己的網站）
# --wait/--random-wait  放慢速度，避免對方主機負載
# --restrict-file-names=windows  讓含 ? 的檔名在 Windows 也能存檔
# 刻意不加 --convert-links，以保留原始網址供後續結構分析
wget --mirror \
     --page-requisites \
     --no-parent \
     --execute robots=off \
     --restrict-file-names=windows \
     --user-agent="${UA}" \
     --wait=1 --random-wait \
     --tries=3 --timeout=30 \
     --span-hosts \
     --domains=novananoinks.com.tw,www.novananoinks.com.tw \
     --directory-prefix="${OUT}" \
     "${SITE}" || true
# wget 對部分 404 會回傳非零結束碼，不影響整體鏡像結果，故以 || true 收斂

echo
echo "===== 鏡像完成 ====="
echo "總大小：$(du -sh "${OUT}" 2>/dev/null | cut -f1)"
echo "檔案數：$(find "${OUT}" -type f 2>/dev/null | wc -l | tr -d ' ')"
echo
echo "各類型檔案數量："
find "${OUT}" -type f 2>/dev/null | sed 's/.*\.//' | tr 'A-Z' 'a-z' \
  | sort | uniq -c | sort -rn | head -15
echo
echo "下一步：將 site-mirror/ 加入 git 並推送，然後通知 Claude 開始分析。"
echo "  git add site-mirror"
echo "  git commit -m '加入現行網站完整鏡像檔'"
echo "  git push -u origin claude/website-clone-assessment-x09jd5"
