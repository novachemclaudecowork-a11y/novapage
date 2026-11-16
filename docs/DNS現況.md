# DNS 現況紀錄

搬家前必須先把現有紀錄抄齊，這份文件就是那張底稿。
查詢工具：<https://mxtoolbox.com/SuperTool.aspx>（橘色按鈕旁的下拉箭頭可切換查詢類型）。

最後更新：2026-11-16

---

## 結論先講

**DNS 不在設計公司手上。** 名稱伺服器是 `ns11/ns12.twnic.net.tw`——
台灣網路資訊中心，隨 `.tw` 網域註冊附帶的 DNS 代管。

網域是公司自己註冊的，所以**這一層本來就在公司手上**，
接管 DNS 不需要設計公司配合，也不需要向他們索取任何東西。

設計公司掌握的只有「網站主機」那一台（Vultr VPS），
而新站不會用到它。

---

## 已查到的紀錄

| 類型 | 名稱 | 值 | TTL | 說明 |
| --- | --- | --- | --- | --- |
| NS | `novananoinks.com.tw` | `ns11.twnic.net.tw` | 60 min | TWNIC |
| NS | `novananoinks.com.tw` | `ns12.twnic.net.tw` | 60 min | TWNIC |
| A | `novananoinks.com.tw` | `45.77.23.226` | 30 min | Vultr（AS20473），設計公司架站的 VPS |
| MX | `novananoinks.com.tw` | `mailfilter.novananoinks.com.tw`（Pref 5） | 30 min | **信件入口，絕對不能漏** |
| A | `mailfilter.novananoinks.com.tw` | `210.71.187.212` | — | HiNet（AS3462），郵件過濾主機 |

### 還沒查的

- [ ] `www.novananoinks.com.tw` 的 A 或 CNAME（實際對外網址是 www，可能與上面那筆不同）
- [ ] TXT 紀錄（含 SPF；自動掃描最常漏掉這一類）

### DNS 健康狀況

MXToolbox 的 DNS Check 除兩項 SOA 格式建議外全綠：
名稱伺服器皆有回應、皆具權威性、與上層紀錄一致。
那兩項 SOA 建議是 TWNIC 自己的設定，與本公司無關，也無從調整，可忽略。

---

## 待釐清：mailfilter 是誰的服務

`mailfilter.novananoinks.com.tw` 指向 HiNet 網段，幾乎確定是中華電信的郵件服務
（過濾垃圾信後再轉給實際信箱）。但**是誰申辦的、哪個方案、還有沒有人在用**，
目前不明。動 DNS 前必須先確認：

- [ ] 公司有沒有人在用 `@novananoinks.com.tw` 結尾的信箱？
- [ ] 中華電信帳單上有沒有郵件相關的月租項目？
- [ ] 打中華電信客服，報統編與網域，問這個網域綁了什麼郵件服務

> ⚠️ 在確認之前，**不要以為沒人用就刪掉**。
> 信件中斷是無聲的故障——網站看起來正常，但寄信的人不會馬上收到退信，
> 往往幾天後才發現沒人回信。

---

## 另一件事：註冊商帳號的密碼

DNS 在 TWNIC，代表控制權跟著「網域註冊帳號」走。
若當初曾把帳號密碼交給設計公司代為設定，**對方現在仍改得動 DNS**。

- [ ] 確認誰持有註冊商（TWNIC 或其代理商）的登入帳號
- [ ] 若設計公司曾經取得，**改密碼**，並開啟兩階段驗證（若有提供）

這比搬到 Cloudflare 更優先——帳號沒鎖好，搬到哪裡都一樣。

---

## 為什麼仍然建議搬到 Cloudflare

DNS 既然已經在公司手上，搬家就不是為了「取回控制權」，而是技術上的需要：

新站跑在 **Cloudflare Workers** 上。Workers 要掛自有網域，
**該網域的名稱伺服器必須指向 Cloudflare**，無法只用一筆 CNAME 從外部指過來。

所以流程是：

1. 在 Cloudflare 加入網域，把上表所有紀錄**原封不動**建好
   （`mailfilter` 那筆 A 紀錄的雲朵務必設為**灰色 DNS only**，
   橘色代理不處理郵件，開了會讓信件全斷）
2. 到註冊商把名稱伺服器改成 Cloudflare 給的兩組
3. 等生效，確認網站與信件都正常
4. **隔幾天**再把網站指向新站——一次只改一件事

詳細步驟見〈接管檢查清單〉第二節。
