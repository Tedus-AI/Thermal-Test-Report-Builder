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

## 開發

```
index.html     UI 與報告邏輯
fileDb.js      本機資料庫檔（File System Access API、寫入佇列、衝突偵測、每日備份、SharePoint 同步標記）
dbAdapter.js   報告 / 頁面 CRUD
spSync.js      SharePoint 雙存檔（MSAL.js + Microsoft Graph，eTag）
auth.html      Microsoft 登入重新導向頁
tests/         Playwright 回歸測試（tests/fake-sharepoint.js 為假的 Graph / MSAL）
```

測試：`npm install --no-save playwright@1.56.1 && node tests/smoke.js`
（`SMOKE_ONLY=<名稱片段>` 只跑符合的測試）。
