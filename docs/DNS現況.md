# DNS 現況與搬家對照表

最後更新：2026-11-16　資料來源：TWNIC 網域名稱註冊系統（DNS設定/代管，主機模式）

---

## 結論先講

**DNS 一直都在公司手上。** 名稱伺服器是 `ns11/ns12.twnic.net.tw`，
TWNIC 代管，隨 `.tw` 網域註冊附帶。公司持有 TWNIC 帳號，可直接編輯所有紀錄。

接管 DNS **不需要設計公司配合，也不需要向他們索取任何東西**。
他們掌握的只有架站的那台 Vultr VPS（45.77.23.226），而新站不會用到它。

- [x] 確認註冊商帳號在公司手上（TWNIC，可直接登入）
- [x] 變更密碼（2026-11-16 已完成）

---

## 現有紀錄（完整，共 7 筆）

| # | 名稱 | 類型 | 值 | 用途 |
| --- | --- | --- | --- | --- |
| 1 | `novananoinks.com.tw` | A | `45.77.23.226` | 網站主機（Vultr，設計公司的 VPS） |
| 2 | `www.novananoinks.com.tw` | A | `45.77.23.226` | 同上 |
| 3 | `mail.novananoinks.com.tw` | A | `202.39.131.130` | **郵件主機**（HiNet） |
| 4 | `mailfilter.novananoinks.com.tw` | A | `210.71.187.212` | **垃圾信過濾**（HiNet） |
| 5 | `webmail.novananoinks.com.tw` | CNAME | `mail.novananoinks.com.tw.` | **網頁版信箱入口** |
| 6 | `novananoinks.com.tw` | TXT | `v=spf1 include:hibox.hinet.net ~all` | **寄信驗證（SPF）** |
| 7 | `novananoinks.com.tw` | MX | `mailfilter.novananoinks.com.tw.` | **信件入口** |

加上 TWNIC 自動帶入的兩筆 NS（`ns11` / `ns12.twnic.net.tw`）。

### mailfilter 的身分已查明

第 6 筆的 `include:hibox.hinet.net` 指出郵件服務是 **中華電信 HiBox 企業郵件**。
第 3、4、5、6、7 筆全是同一套 HiBox 的組成：

```
外部寄信 → MX → mailfilter（過濾垃圾信）→ mail（郵件主機）
                                              ↑
                        員工收信：郵件軟體連 mail，或瀏覽器開 webmail
公司寄信 → 經 hibox.hinet.net 送出 → 收件方查 SPF（第 6 筆）確認是本人
```

**也就是說，公司確實有 `@novananoinks.com.tw` 的信箱在運作。**
七筆紀錄裡有五筆是郵件用的，搬家時全部都要原封不動帶走。

---

## 搬到 Cloudflare 的對照表

照這張表逐筆建立。**「代理狀態」那一欄填錯會讓信件全斷，務必確認。**

| 類型 | 名稱 | 內容 | 代理狀態 |
| --- | --- | --- | --- |
| A | `novananoinks.com.tw`（或填 `@`） | `45.77.23.226` | **灰色 DNS only** |
| A | `www` | `45.77.23.226` | **灰色 DNS only** |
| A | `mail` | `202.39.131.130` | **灰色 DNS only** |
| A | `mailfilter` | `210.71.187.212` | **灰色 DNS only** |
| CNAME | `webmail` | `mail.novananoinks.com.tw` | **灰色 DNS only** |
| TXT | `novananoinks.com.tw`（或 `@`） | `v=spf1 include:hibox.hinet.net ~all` | 不適用 |
| MX | `novananoinks.com.tw`（或 `@`） | `mailfilter.novananoinks.com.tw`，Priority **5** | 不適用 |

> ⚠️ **橘色雲朵（Proxied）只處理網頁流量，不處理郵件。**
> `mail`、`mailfilter`、`webmail` 任何一筆開成橘色，信件立刻全斷。
> 這是搬家最常見的致命錯誤，建立完務必再檢查一次這三筆。

> 💡 網站那兩筆（`@` 與 `www`）這個階段也先設灰色，
> 讓網站的行為與現在完全一致。等到真的要切換新站時再處理。

### 漏掉任何一筆會發生什麼

| 漏掉 | 後果 |
| --- | --- |
| MX 或 A `mailfilter` | **收不到信** |
| A `mail` | 員工的郵件軟體（Outlook 等）連不上，**收發都中斷** |
| CNAME `webmail` | 網頁版信箱打不開 |
| TXT（SPF） | **公司寄出去的信開始被判定為垃圾信** |

---

## 執行順序

1. **先不要動 TWNIC 上的任何紀錄。** 那張表就是備援。
2. 在 Cloudflare 加入網域（Free 方案），依上表逐筆建立
3. 逐筆核對，特別檢查三筆郵件紀錄都是**灰色**
4. 回 TWNIC，把名稱伺服器改成 Cloudflare 給的兩組
   （TWNIC 的「DNS設定/代管」頁面上方有「DNS 模式（自行管理）」選項，
   切到該模式即可填入外部名稱伺服器）
5. 等生效（數小時，最長 48 小時）
6. 驗證：
   - [ ] 網站 `www.novananoinks.com.tw` 內容與以前相同
   - [ ] 用 Gmail 寄一封信到公司信箱，**確認收得到**
   - [ ] 從公司信箱寄一封出去，**確認沒進對方的垃圾信匣**
   - [ ] `webmail.novananoinks.com.tw` 打得開
7. **隔幾天**，確認一切穩定後，才把 `@` 與 `www` 指向新站

> **TWNIC 上的舊紀錄不要刪。** 留著當退路——萬一出狀況，
> 把名稱伺服器改回 `ns11/ns12.twnic.net.tw` 就全部復原。

---

## 仍待確認

- [ ] HiBox 的**管理者帳號**在誰手上？設計公司若曾取得，一併改密碼。
      （這與 DNS 是兩套獨立的帳號，改了 TWNIC 不代表 HiBox 也安全）
- [ ] 公司目前有哪些 `@novananoinks.com.tw` 信箱在使用？列一份清單，
      搬家後逐一測試收發。
- [ ] Vultr 那台 VPS 的月租掛在誰帳上？新站上線後可評估退租。

### 暫時不要動的事

TXT 紀錄目前只有 SPF，**沒有 DMARC**。補 DMARC 對「公司寄出去的信不被當垃圾信」
有幫助，但那是另一件事——**搬家期間不要一起改**，一次只動一件事才查得出問題。
等 DNS 穩定後再處理。
