# Thermal-Test-Report-Builder

熱測試報告產生器：單一 `index.html`，在瀏覽器裡編排封面、目錄、數據頁、比對頁、比較頁、結論頁等，匯出 PDF。
規格見 [SPEC.md](SPEC.md)。

## 資料存在哪裡

| 位置 | 說明 |
|---|---|
| **本機資料庫檔**（必要） | 首頁「📂 開啟既有資料庫 / 🆕 建立新資料庫」選一個 `.json`（可放共用磁碟）。修改後自動存檔；「🗂 自動備份」指定資料夾後每日備份（保留 30 份） |
| **SharePoint**（建議） | 首頁或編輯器工具列的「☁ SharePoint」按鈕 → 以公司 Microsoft 帳號登入。之後**本機與 SharePoint 同時存檔**：本機存檔後約 4 秒只上傳有變更的報告，每 60 秒拉回同事改過的報告 |

SharePoint 上的位置（`Thermal-Spec-DB` 網站 → 文件，資料夾不存在時工具會自動建立）：

```
Thermal_Report_Builder/
├── Database/
│   ├── reports/<reportId>.json   每份報告一個檔
│   └── tim_library.json          共用 TIM 材料庫
├── Backup/                       每日備份（保留 30 份）
└── Reports/<案名>_<Stage>/       匯出 PDF 時可勾選同時上傳
```

- 兩人同時改同一份報告：你的版本寫入，對方的版本另存為「（衝突副本 · 對方 · 時間）」報告並提示，不會互相覆蓋。
- 正在編輯的報告不會被背景同步替換；離開編輯器後才套用別人的修改。
- 斷線或登入過期：工具列顯示「未同步」/「請重新登入」，修改留在本機檔案裡，恢復後自動補傳（重新整理也不會遺失）。
- 換電腦：建立一個新的空白本機資料庫並啟用 SharePoint，所有報告會自動下載。

### SharePoint 設定（一次性）

1. **不需要改 Azure**：與 Project-TIM-management-tool 共用同一個 Azure 應用程式。工具放在 `https://tedus-ai.github.io/` 時，
   登入直接沿用 TIM 工具已登記的 `https://tedus-ai.github.io/Project-TIM-management-tool/auth.html`（同一個網域，所以可以共用；
   在 TIM 工具登入過，這裡通常就不用再登入）。權限沿用 `Files.ReadWrite.All`、`Sites.Read.All`、`Sites.ReadWrite.All`。
   只有在別的網址開啟（例如 `http://localhost:<port>/`）時，才要到 **Microsoft Entra ID → 應用程式註冊 → 驗證 →
   單頁應用程式（SPA）的重新導向 URI** 加上該網址旁的 `auth.html`。
2. 使用者需要 `Thermal-Spec-DB` 網站的編輯權限。網站與資料夾路徑在 `spSync.js` 的 `CONFIG`。

> ⚠️ 請不要把資料庫 JSON、匯出的 PDF 或任何實際專案資料 commit 進來（CI 會擋 `*.json`）。

## 用最少步驟做完一份報告

| 步驟 | 省時的做法 |
|---|---|
| 開新報告 | 「+ 新增報告」選 **標準架構**（封面、圖片、標註、數據、比對、結論一次建好），或 **以既有報告為範本**：沿用頁面、元件清單、規格、Ta 條件與記錄器通道對應，只清空量測值、功耗、模擬值與結論（首頁卡片的「當範本新增」也可以）。部門 / Tested by 會記住上次填的 |
| 放照片 | 「新增頁面 → 🖼 批次圖片頁…」一次選多張，依檔名排序、每頁 1 / 2 / 4 張、檔名當說明；在圖片頁一次拖多張（每頁最多 6 張）也會自動續頁 |
| 標註 | 標註頁「✎ 批次命名」：從 Excel 貼一欄名稱，依序套用到所有標註點 |
| 填元件 | 「⇩ 帶入標註頁元件」後，**規格記憶**會自動帶入其他報告填過的同名元件規格（Spec Type / Tc Spec / Derating / TIM）；元件名稱欄也有下拉提示 |
| 填實測值 | 「📥 匯入記錄器 CSV」或直接把 CSV 拖到數據頁：每個通道取**最後 N 分鐘平均**，檢查**穩態**（區間溫差 ≤ 1°C，可改），依通道名稱 / 上次的對應 / 順序自動配對元件；有環溫通道時自動選最接近的 Ta，可選擇修正到目標 Ta。支援 Keysight、Graphtec、Yokogawa、Hioki 等 CSV / TXT |
| 下一個測試條件 | 頁面清單右鍵「複製為新測試條件（清空量測值）」，直接輸入條件名稱 |
| 模擬比對 | 比對頁「貼上模擬結果」：從 FloTHERM / Icepak / Excel 複製「元件名稱 + 溫度」兩欄貼上，依名稱對應，比對表還沒有的元件自動加入 |
| 結論 | 「✨ 產生結論草稿」依各測試條件的 Pass / Warning / Fail、最小 Margin、功耗與模擬偏差寫出草稿；「⇩ 由 Fail / Warning 產生」把問題元件寫進 Issues Found |
| 匯出前 | 匯出視窗的**報告檢查**列出漏填（未填實測值、未命名、缺 Sim Tc、Fail 未列入 Compliance…），點一下跳到該頁；可勾選同時上傳 PDF 到 SharePoint |
| 封面 | Stage 改一次，所有數據頁跟著改；可填「審核 / 核准」（空白不印） |
| 圖片頁 | 編輯畫面就是 PDF 那一頁。右側選版面（自動 / 1 / 2 / 3 / 1 大 + 2 小 / 2×2 / 3×2），拖格線調整大小；點照片後工具列可旋轉、翻轉、裁切、調亮度、放大並拖曳移動畫面；把照片拖到另一格就交換位置。標註點 / 圈選 / 方框 / 文字框（D / C / R / T）畫上去就地打字，放大或旋轉照片時標註跟著照片 |
| 複製圖片 | 圖片頁 / 標註頁工具列「複製」（或 Ctrl+C）：到任何圖片頁 / 標註頁按 Ctrl+V（或右側「📋 貼上複製的圖片」）貼上，也可直接「貼到新的圖片頁 / 標註頁」。保留旋轉、翻轉與說明，不會重新壓縮；也能貼到 PowerPoint 等其他程式 |
| 標註頁 | 編輯畫面就是 PDF 那一頁（所見即所得）。拖曳照片時標註點與標籤整組跟著走；旋轉 / 翻轉 / 裁切時標註點留在照片同一位置。右側「待放置元件」→「▶ 依序放置」：依數據頁元件順序逐一點照片上的位置，名稱自動帶入。「一鍵排版」自動決定照片大小並把標籤排在兩側（引線不交叉、不蓋到標註點）。**最多 2 張照片**：版面配置 自動 / 左右 / 上下，各自在自己的半邊排標籤，可交換位置；每張照片可加**圖片說明**（印在圖下）。工具列滑過有說明，快捷鍵 V / A / Delete / 方向鍵 / Ctrl+D |
| 標註頁的溫度 | 右側「量測溫度」選數據頁與 Ta，每個標籤旁顯示實測 Tc 並依 Pass / Warning / Fail 上色（PDF 也有）；批次命名可直接帶入數據頁元件名稱 |
| 數據頁排序 | 「⇅ 排序…」依類別 / 名稱 / 最差 Margin / 最高 Tc 重排（Ctrl+Z 可復原） |
| 比較測試條件 / Stage | 「新增頁面 → ⚖ 比較頁」：預設帶入本報告各數據頁（例：RF 補償前後），也可選其他報告的數據頁（例：EVT vs DVT）。依元件名稱對應，列出各自的 Tc 與 ΔTc（降溫綠、升溫紅）、依 \|ΔTc\| 排序，並寫出平均 / 降溫最多 / 升溫最多摘要（結論草稿也會帶入）。其他報告的數值存快照，來源被刪也照常印出 |
| 目錄 | 「新增頁面 → 📑 目錄頁」插在封面後，自動列出各頁與 PDF 頁碼（只匯出部分頁面時也會重算） |
| 比對頁圖表 | 表格下方自動畫 Sim vs Meas 長條圖（含 Derated Spec 標線；Dev% 排成上方同一列，依判斷上色），超過 18 顆元件自動分成多張圖讓間距夠寬，PDF 一起印出、可關閉；「✨ 產生比對結論」寫出偏差統計與系統偏高 / 偏低判斷 |
| 結論的行動 | Next Action「⇩ 由 Fail / Warning 產生」：Owner 預設 Tested by、期限兩週 |
| 備註轉報告 | 備註頁記錄裡的截圖按「→ 圖片頁」直接做成圖片頁（插在結論頁前） |
| PDF | 每頁頁尾有頁碼（封面除外）；數據頁標題印出測試條件；檔名含版本；預覽中雙擊頁面回到該頁編輯 |
| 隨時 | 數據頁上方摘要列（Pass / Warning / Fail 數、最小 Margin、最高 Tc，點名稱跳到該列）；頁面清單的狀態徽章（❌ / ⚠ / ✓ / 已量測數 / 空）；Ctrl+S 立即存檔並同步；首頁搜尋（按 /）、Stage 篩選、排序 |

## 部署與自動更新

網站由 `.github/workflows/pages.yml` 部署到 GitHub Pages（**一次性設定**：repo 的 Settings → Pages → Build and deployment →
Source 選 **GitHub Actions**）。每次 push 到 main，部署會把建置版本號蓋進 `index.html` 與 `version.json`。

開著的工具每 5 分鐘（以及切回視窗時）檢查 `version.json`：有新版本就跳出提示倒數 10 秒（沒開報告時 3 秒），
**先強制存檔**（本機資料庫檔 + SharePoint 同步），再自動載入新版本並回到原本的報告與頁面。
存檔失敗（例如檔案衝突）時不會更新，頂端會顯示原因與「重試」，不會蓋掉未存的資料。

若 Source 還是「Deploy from a branch」，每次 push 會跑兩次部署（`pages.yml` 與 GitHub 內建的 pages build），
較晚完成的分支部署沒有版本號、會蓋掉有版本號的那份。此時工具改用頁面的 `Last-Modified` 日期比對（HEAD 請求），
仍然會偵測到新部署並走同樣的「先存檔再更新」流程；提示中的版本會顯示為部署日期（例如 `2026/10/07 11:28 版`）。
建議還是把 Source 改成 GitHub Actions，只保留一次部署。本機（localhost / 127.x）開啟時不檢查更新。

## 開發

```
index.html     UI 與報告邏輯
fileDb.js      本機資料庫檔（File System Access API、寫入佇列、衝突偵測、每日備份、SharePoint 同步標記）
dbAdapter.js   報告 / 頁面 CRUD
spSync.js      SharePoint 雙存檔（MSAL.js + Microsoft Graph，eTag）
loggerCsv.js   記錄器 CSV / TXT 解析（分隔符號、標題列、時間欄、穩態統計）
auth.html      Microsoft 登入重新導向頁
version.json   建置版本號（佔位字串，部署時蓋上；不要手動改）
tests/         Playwright 回歸測試（tests/fake-sharepoint.js 為假的 Graph / MSAL）
```

測試：`npm install --no-save playwright@1.56.1 && node tests/smoke.js`
（`SMOKE_ONLY=<名稱片段>` 只跑符合的測試）。
