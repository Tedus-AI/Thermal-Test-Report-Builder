# Thermal-Test-Report-Builder

熱測試報告產生器：單一 `index.html`，在瀏覽器裡編排封面、數據頁、比對頁、結論頁等，匯出 PDF。
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
| 放照片 | 「新增頁面 → 🖼 批次圖片頁…」一次選多張，依檔名排序、每頁 1 / 2 / 4 張、檔名當說明；在圖片頁一次拖多張也會自動續頁 |
| 標註 | 標註頁「✎ 批次命名」：從 Excel 貼一欄名稱，依序套用到所有標註點 |
| 填元件 | 「⇩ 帶入標註頁元件」後，**規格記憶**會自動帶入其他報告填過的同名元件規格（Spec Type / Tc Spec / Derating / TIM）；元件名稱欄也有下拉提示 |
| 填實測值 | 「📥 匯入記錄器 CSV」或直接把 CSV 拖到數據頁：每個通道取**最後 N 分鐘平均**，檢查**穩態**（區間溫差 ≤ 1°C，可改），依通道名稱 / 上次的對應 / 順序自動配對元件；有環溫通道時自動選最接近的 Ta，可選擇修正到目標 Ta。支援 Keysight、Graphtec、Yokogawa、Hioki 等 CSV / TXT |
| 下一個測試條件 | 頁面清單右鍵「複製為新測試條件（清空量測值）」，直接輸入條件名稱 |
| 模擬比對 | 比對頁「貼上模擬結果」：從 FloTHERM / Icepak / Excel 複製「元件名稱 + 溫度」兩欄貼上，依名稱對應，比對表還沒有的元件自動加入 |
| 結論 | 「✨ 產生結論草稿」依各測試條件的 Pass / Warning / Fail、最小 Margin、功耗與模擬偏差寫出草稿；「⇩ 由 Fail / Warning 產生」把問題元件寫進 Issues Found |
| 匯出前 | 匯出視窗的**報告檢查**列出漏填（未填實測值、未命名、缺 Sim Tc、Fail 未列入 Compliance…），點一下跳到該頁；可勾選同時上傳 PDF 到 SharePoint |
| 隨時 | 數據頁上方摘要列（Pass / Warning / Fail 數、最小 Margin、最高 Tc，點名稱跳到該列）；頁面清單的狀態徽章（❌ / ⚠ / ✓ / 已量測數 / 空）；Ctrl+S 立即存檔並同步；首頁搜尋（按 /）、Stage 篩選、排序 |

## 部署與自動更新

網站由 `.github/workflows/pages.yml` 部署到 GitHub Pages（**一次性設定**：repo 的 Settings → Pages → Build and deployment →
Source 選 **GitHub Actions**）。每次 push 到 main，部署會把建置版本號蓋進 `index.html` 與 `version.json`。

開著的工具每 5 分鐘（以及切回視窗時）檢查 `version.json`：有新版本就跳出提示倒數 10 秒（沒開報告時 3 秒），
**先強制存檔**（本機資料庫檔 + SharePoint 同步），再自動載入新版本並回到原本的報告與頁面。
存檔失敗（例如檔案衝突）時不會更新，頂端會顯示原因與「重試」，不會蓋掉未存的資料。

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
