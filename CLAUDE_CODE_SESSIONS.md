# Claude Code 分段執行 Prompts
# Thermal Test Report Builder — Phase 1

每個 Session 獨立執行，完成後確認畫面正常再進行下一段。
---

## ╔══ SESSION 1 ══╗
## 建立 HTML 骨架 + CSS Design System + Firebase 初始化

```
請在目錄中建立 index.html，這是一個熱流實驗報告書產生器工具。

【這個 Session 只做以下三件事，不要做其他任何功能】

━━━ 1. Firebase 初始化 ━━━
用以下 config 初始化 Firebase（Firestore + Storage），並啟用 offline persistence：

const firebaseConfig = {
  apiKey: "AIzaSyBBhIIGUe3yzxarC3OHoIhuFr5Yg8IfAoo",
  authDomain: "thermal-test-report-builder.firebaseapp.com",
  projectId: "thermal-test-report-builder",
  storageBucket: "thermal-test-report-builder.firebasestorage.app",
  messagingSenderId: "440712941744",
  appId: "1:440712941744:web:0f4417911669e43e0f2b75"
};

透過 CDN 引入 Firebase SDK 10.x。

━━━ 2. CSS Design System（Liquid Glass）━━━
在 <style> 裡定義以下 CSS 變數，之後所有元件都用這些變數：

/* 背景 */
--bg-base: #0a0f1e;
--bg-gradient: linear-gradient(135deg, #0a0f1e 0%, #0d1b2e 50%, #0a1628 100%);

/* 環境光暈（偽元素實作在 body::before/::after）*/
--bg-glow-1: radial-gradient(ellipse at 20% 20%, rgba(56,189,248,0.08) 0%, transparent 60%);
--bg-glow-2: radial-gradient(ellipse at 80% 80%, rgba(99,102,241,0.06) 0%, transparent 60%);

/* 玻璃材質 */
--glass-bg: rgba(255,255,255,0.08);
--glass-bg-hover: rgba(255,255,255,0.12);
--glass-bg-active: rgba(255,255,255,0.16);
--glass-border: rgba(255,255,255,0.18);
--glass-border-top: rgba(255,255,255,0.35);
--glass-blur: 20px;
--glass-blur-heavy: 40px;
--glass-shadow: 0 8px 32px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2);

/* 語義色 */
--color-primary: rgba(56,189,248,1);
--color-primary-glass: rgba(56,189,248,0.15);
--color-primary-glow: rgba(56,189,248,0.30);
--color-success: rgba(34,197,94,1);
--color-warning: rgba(250,204,21,1);
--color-danger: rgba(239,68,68,1);

/* 文字 */
--text-primary: rgba(255,255,255,0.95);
--text-secondary: rgba(255,255,255,0.60);
--text-placeholder: rgba(255,255,255,0.30);
--text-on-white: rgba(15,23,42,0.90);

/* 字型 */
--font-ui: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang TC", sans-serif;
--font-data: "SF Mono", "JetBrains Mono", monospace;

/* 間距（4px base）*/
--space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px;
--space-5:20px; --space-6:24px; --space-8:32px; --space-10:40px;

/* 圓角 */
--radius-sm:8px; --radius-md:12px; --radius-lg:16px;
--radius-xl:20px; --radius-2xl:24px; --radius-full:9999px;

/* 過渡 */
--transition-fast:0.15s ease;
--transition-base:0.20s ease;
--transition-slow:0.30s ease;

━━━ 3. 三欄佈局（空殼，無功能）━━━
實作以下 HTML 結構與對應樣式：

【Toolbar 頂部】
- 高度 56px，背景 glass（backdrop-filter blur 20px）
- 左側：工具名稱「🌡 Thermal Report Builder」
- 中間：按鈕群組（先放佔位按鈕）：[+ 新增頁面 ▾]  [預覽]  [匯出 PDF]
- 右側：狀態列文字（預設顯示「就緒」）
- 按鈕樣式：glass button（透明玻璃底 + 藍色高光邊）

【左側 Sidebar】
- 寬度 220px，固定，背景 glass（blur 20px）
- 右側有 1px glass border
- 內部有一個空的頁面列表 div（id="page-list"）
- 底部有「+ 新增頁面」文字按鈕
- 引入 SortableJS CDN，對 page-list 初始化 Sortable（暫時無 data 所以是空的）

【主編輯區】
- 背景：深色漸層（--bg-gradient）+ body::before/::after 做環境光暈
- 中間顯示一個白色 A4 比例的 div（id="editor-canvas"）
  - 直向：width 595px, height 842px（A4 @72dpi 比例）
  - 白色背景，圓角 4px，box-shadow 有深度感
  - 內部目前空白，中央顯示 placeholder 文字「← 請從左側選擇或新增頁面」

完成後在瀏覽器打開確認三欄佈局正常、玻璃效果有出現，截圖給我看。
不要開始做任何 Module 功能。
```

---

## ╔══ SESSION 2 ══╗
## Module 1：封面頁 + Firestore 自動儲存

```
在現有 index.html 基礎上，實作 Module 1 封面頁。

【前提】
- Firebase 已初始化完成
- 三欄佈局骨架已存在
- 所有樣式用既有 CSS 變數

━━━ 功能需求 ━━━

1. 「+ 新增頁面」按鈕點擊後，出現下拉選單（先只有「封面頁」一個選項），
   選擇後在左側 page-list 新增一個列表項目，右側 editor-canvas 顯示封面頁編輯介面。

2. 封面頁（A4 直向：595×842px 白底）的欄位：
   - 公司/部門（Dept.）：文字輸入，頁面頂部
   - 封面圖（Product Photo）：可拖拉/選檔/Ctrl+V 貼上，置中大圖，可刪除替換
   - 案名（Project Name）：大字文字輸入，置中
   - 產品型號（Model）：文字輸入
   - 測試階段（Stage）：下拉選單 [Prototype / EVT / DVT / PVT / MP]
   - 實驗人員（Tested By）：文字輸入
   - 日期（Date）：date input，預設今日
   - 版本號（Report Version）：文字輸入，預設 v1.0

3. Firestore 資料結構：
   - collection: thermal_reports
   - document id: 自動生成（開啟工具時若無則建立，存在則載入）
   - 封面頁資料存在: reports/{id}/pages/0/
     { type:"cover", order:0, data:{ project_name, model, stage, tested_by, date, dept, report_version } }
   - 圖片：若 < 500KB 存 base64 在 data.cover_image，否則上傳 Firebase Storage 存 URL
   - 任何欄位變更後 debounce 1000ms 自動寫入 Firestore
   - Toolbar 右側狀態列：儲存中.../已儲存 ✅/離線模式 ⚠️

4. 左側列表項目：
   - 顯示「🏠 封面頁」
   - 點選後 editor-canvas 顯示該頁內容
   - 右鍵選單有「刪除」選項（需確認 dialog）

完成後確認：欄位可輸入、圖片可貼上、Firestore 有寫入資料。
```

---

## ╔══ SESSION 3 ══╗
## Module 2：圖片頁（2×2 四象限動態排版）

```
在現有 index.html 基礎上，新增 Module 2 圖片頁。

━━━ 新增頁面選單 ━━━
「+ 新增頁面」下拉選單加入「圖片頁」選項。
同一份報告可以新增多個圖片頁。

━━━ 圖片頁規格（A4 橫向：842×595px 白底）━━━

1. 頁面頂部：可編輯標題欄（placeholder：「點此輸入標題」），字體較大

2. 標題下方：2×2 四象限圖片區（左上、右上、左下、右下）

3. 動態排版規則（圖片數量決定佈局）：
   - 0張：顯示全版 placeholder「+ 點此或拖拉圖片」
   - 1張：全版單張（標題下方佔滿）
   - 2張：左上+右上，各佔半版，下半空
   - 3張：左上+右上+左下，右下顯示「+」placeholder
   - 4張：完整 2×2

4. 每個圖片格：
   - 空格：虛線框 + 「+」圖示，可點擊選檔 / 拖拉圖片進來 / Ctrl+V 貼上
   - 有圖：圖片 object-fit: contain 填滿格子
   - hover 時顯示浮動工具列：[替換] [刪除]
   - 圖片下方：一行可編輯說明文字（灰色虛線底線，placeholder：「點此輸入說明」）

5. Firestore 結構：
   pages/{index}/ { type:"image", order:N, data:{ title, images:[{position, url_or_base64, caption}] } }
   圖片同樣採用 500KB 門檻決定存 base64 或 Storage URL

6. 左側列表顯示「🖼 圖片頁」，多個圖片頁依序顯示編號（圖片頁 1、圖片頁 2...）

完成後確認：可新增多個圖片頁、四種佈局動態切換正常、Ctrl+V 貼圖有效。
```

---

## ╔══ SESSION 4 ══╗
## Module 6：結論頁

```
在現有 index.html 基礎上，新增 Module 6 結論頁。

━━━ 新增頁面選單 ━━━
「+ 新增頁面」下拉加入「結論頁」選項。

━━━ 結論頁規格（A4 直向：595×842px 白底）━━━

四個區塊，由上而下：

1. 【結論摘要 Summary】
   - 區塊標題：「Conclusion」（灰色小標）
   - 富文本輸入區（contenteditable div）
   - 支援：粗體（Ctrl+B）、條列（自動偵測「- 」開頭換行轉為 • ）
   - placeholder：「請輸入實驗結論...」

2. 【合規性總表】（Phase 2 自動帶入，目前為手動輸入版本）
   - 區塊標題：「Compliance Summary」
   - 一個簡易表格，欄位：元件名稱 / 最高量測 Tc / Derated Spec / 判斷
   - 可手動新增列（「+ 新增元件」按鈕）
   - 判斷欄：下拉 [✅ Pass / ⚠️ Warning / ❌ Fail]
   - 判斷欄依選擇自動套用綠/黃/紅底色

3. 【發現問題 Issues Found】
   - 條列輸入，每條一行，Enter 新增下一條，Backspace 空行刪除

4. 【後續行動 Next Action】
   - 條列輸入，每條有三個欄位：[行動描述] [Owner] [Due Date]
   - 「+ 新增行動」按鈕

━━━ Firestore ━━━
pages/{index}/ { type:"conclusion", order:N, data:{ summary, compliance:[], issues:[], actions:[] } }

左側列表顯示「📝 結論頁」

完成後確認四個區塊都可以輸入且自動儲存。
```

---

## ╔══ SESSION 5 ══╗
## 頁面拖曳排序 + 預覽模式 + PDF 匯出

```
在現有 index.html 基礎上，實作三個全域功能。

━━━ 功能 1：頁面拖曳排序 ━━━
- 左側 page-list 的項目可以上下拖曳改變順序（SortableJS 已引入）
- 拖曳放開後，自動更新所有頁面的 order 欄位並寫回 Firestore
- 拖曳時項目有視覺位移動畫

━━━ 功能 2：頁面複製 ━━━
- 右鍵選單（或列表項目上的 ⋯ 按鈕）加入「複製此頁」
- 複製後在原頁後方插入一份相同內容的新頁

━━━ 功能 3：預覽模式 ━━━
- Toolbar「預覽」按鈕點擊後，進入全螢幕 Slide Show
- 黑色全螢幕背景，中央顯示當前 A4 頁面（白底，依頁面方向縮放至適合螢幕）
- 左/右鍵盤方向鍵切換頁面
- 頁面左下角顯示「第 N 頁 / 共 M 頁」
- ESC 或點擊右上角 ✕ 退出預覽模式

━━━ 功能 4：PDF 匯出 ━━━
引入以下 CDN：
- html2canvas 1.4.x
- jsPDF 2.x

「匯出 PDF」按鈕點擊後：
1. Toolbar 顯示「匯出中...」
2. 依左側列表順序，逐頁截圖（html2canvas scale:2, useCORS:true）
3. 每頁依照 A4 尺寸加入 jsPDF（直向/橫向依各頁設定自動判斷）
4. 完成後觸發下載，檔名格式：{ProjectName}_{Stage}_{Date}_ThermalReport.pdf
   （從封面頁 Firestore 資料讀取，若無則用 ThermalReport_{Date}）
5. 匯出期間暫時隱藏所有非 A4 的 UI 元素（Toolbar、Sidebar）以確保截圖乾淨

完成後確認：拖曳排序有效、預覽可切頁、PDF 下載後格式正確。
```

---

## ╔══ SESSION 6 ══╗  ← Phase 2 開始
## Module 3：量測點標註頁（SVG 互動標註）

```
在現有 index.html 基礎上，新增 Module 3 量測點標註頁。

━━━ 新增頁面選單 ━━━
「+ 新增頁面」下拉加入「標註頁」選項。

━━━ 標註頁規格（A4 橫向：842×595px 白底）━━━

1. 頁面頂部：可編輯標題欄（placeholder：「TC Thermocouple Placement」）

2. 主區域結構：
   - 照片插入區（置中，可拖拉/選檔/貼上）
   - 照片四周留 100px 空白區（上下左右），供標籤框擺放
   - 未放照片時顯示虛線框 placeholder

3. 互動標註功能（照片已上傳後啟用）：
   a. 點擊照片任意位置 → 在該位置生成紅色圓點標記，白色數字自動編號（1, 2, 3...）
   b. 從圓點拖曳滑鼠到照片外側空白區 → 放開後生成標籤框
   c. 標籤框：白底黑框，可輸入文字（建議格式 placeholder：「TC1 - 元件名稱」）
   d. 標籤框可自由拖曳移動位置
   e. 標記點到標籤框之間自動顯示 SVG 折線（隨拖曳即時更新）
   f. 右鍵點擊標記點 → [刪除此標記]（連同對應標籤框和折線一起移除）

4. 實作技術：
   - 照片用 <canvas> 或 <img> 顯示
   - 標記點、折線用 SVG overlay（position:absolute, 覆蓋整個編輯區）
   - 標籤框用 absolute positioned div（contenteditable）
   - 匯出/截圖時：標記點+折線+標籤框 全部用 html2canvas 一起截進去

5. Firestore 結構：
   pages/{index}/ {
     type:"annotation", order:N,
     data:{
       title, photo_url_or_base64,
       markers:[{ id, x, y, label, label_x, label_y }]
     }
   }
   （x,y 為佔照片的百分比座標，確保縮放後位置正確）

左側列表：「📍 標註頁」

完成後確認：點擊照片生成標記點、拖曳出標籤框、折線正確連接、可刪除。
```

---

## ╔══ SESSION 7 ══╗
## Module 4a：實驗條件 Header

```
在現有 index.html 基礎上，新增 Module 4 實驗數據頁的第一部分：條件 Header。

━━━ 新增頁面選單 ━━━
「+ 新增頁面」下拉加入「數據頁」選項。

━━━ 數據頁（A4 直向：595×842px 白底）━━━
本 Session 只做頁面上半的 Header 區塊，數據表下一個 Session 做。

【Header 欄位 — 2 欄並排 Grid 排版】
左欄：
- 實驗日期（Test Date）：date input，預設今日
- 產品 Stage：下拉 [Prototype / EVT / DVT / PVT / MP]，與封面頁 Stage 同步
- 軟體版本（SW Version）：文字輸入
- Waveform 版本（Waveform Ver.）：文字輸入

右欄：
- 熱平衡時間（Thermal Equilibrium Time）：數字輸入 + 「min」單位標示
- 產品安裝方式（Mounting）：下拉 [Pole Mount / Wall Mount / Free-standing] + 自訂文字
- 測試地點（Location）：文字輸入（如 Lab / Chamber / Outdoor）

【Ta 條件設定 — Header 底部獨立一行】
- 標題：「量測環境溫度條件（Ta Conditions）」
- 預設兩個 Tag：[Ta = 25°C ✕]  [Ta = 55°C ✕]
- 「+ 新增」按鈕：點擊後輸入溫度值（數字），新增 Tag
- 每個 Tag 可點 ✕ 刪除
- Ta 條件的變更會影響下方數據表的欄位（Session 8 實作）

Header 下方暫時留空（數據表區域），顯示「數據表將在下一步實作」文字。

━━━ Firestore ━━━
pages/{index}/ {
  type:"data", order:N,
  data:{
    header:{ test_date, stage, sw_version, waveform_ver, eq_time_min, mounting, location },
    ta_conditions:[25, 55],
    components:[],
    sensors:[]
  }
}

完成後確認 Header 所有欄位可輸入、Ta Tag 可新增刪除、自動儲存正常。
```

---

## ╔══ SESSION 8 ══╗
## Module 4b：量測數據表（動態欄展開）

```
在現有 index.html 基礎上，實作 Module 4 數據頁的主體：量測數據表。
接續 Session 7 已完成的 Header 區塊，在其下方加入數據表。

━━━ 數據表規格 ━━━

【固定欄（每列必有）】
A: 類別    下拉 [RF / Digital / PWR]，不同類別左側色塊不同（RF=藍/Digital=紫/PWR=橙）
B: #       同類別內自動遞增（RF-1, RF-2...），唯讀
C: 元件名稱  文字輸入
D: Spec Type  下拉 [Recommended / Absolute]
E: Tc Spec (°C)  數字輸入
F: Derating Factor  下拉 [0.80 / 0.85 / 0.90 / 0.95 / 1.00]，預設 0.90
G: Tc Spec Derated  自動計算（= E × F），唯讀，灰色底
H: TIM Type  文字輸入（如 Coolzorb K=11.5）

【動態欄（依 Header 的 Ta 條件自動展開）】
每個 Ta 條件產生 2 欄：
- 實測 Tc @ {Ta}°C：數字輸入
- Margin (%)：自動計算 = (G - 實測Tc) / G × 100，唯讀

Margin 欄背景色：
- ≥ 10%：綠底（#dcfce7）深綠字（#15803d）
- 0%~10%：黃底（#fef9c3）深黃字（#a16207）
- < 0%：紅底（#fee2e2）深紅字（#b91c1c）

【結尾欄】
- Pass/Fail：自動判斷（任一 Ta 的 Margin < 0% → ❌ Fail），整列背景變淡紅
- 備註：文字輸入

【操作】
- 表格底部「+ 新增元件」按鈕，預設帶入上一列的類別
- 列右鍵選單：[刪除此列]
- 同類別的列之間有細分隔線，不同類別之間有較明顯分隔線
- Ta 條件增加/刪除時，動態欄同步展開/收合

【Embedded Sensor 子區塊】（可收合，預設收合）
Header：「▶ Embedded Sensor Readings」點擊展開
展開後顯示簡單表格：
欄位：Sensor 名稱 / 類型（下拉：Tj only / Tj+Tc）/ 各 Ta 讀值（文字）/ 備註
底部「+ 新增 Sensor」按鈕

━━━ Firestore ━━━
components 陣列和 sensors 陣列更新至 data 物件內（結構延續 Session 7）

完成後確認：欄位可輸入、Margin 自動計算顏色正確、新增/刪除列有效、Ta 欄動態展開。
```

---

## ╔══ SESSION 9 ══╗
## Module 5：Sim vs Meas 比對頁

```
在現有 index.html 基礎上，新增 Module 5 Sim vs Meas 比對頁。

━━━ 新增頁面選單 ━━━
「+ 新增頁面」下拉加入「比對頁」選項。

━━━ 比對頁規格（A4 橫向：842×595px 白底）━━━

【上半：圖片區（左右並排）】
- 左側：FloTHERM 截圖插入區（可拖拉/選檔/貼上）+ 說明文字
- 右側：IR / TC 量測照片插入區 + 說明文字
- 兩個插入區各佔 50% 寬度，高度約頁面上半 40%
- 各自獨立插入，互不影響

【中間：比對數據表】
欄位：
- 類別（從 Module 4b 帶入，唯讀）
- 元件名稱（從 Module 4b 帶入，唯讀）
- Tc Spec Derated（從 Module 4b 帶入，唯讀）
- Sim Tc @ 55°C (°C)（手動輸入）
- Meas Tc @ 55°C (°C)（從 Module 4b 的 Ta=55°C 欄自動帶入，唯讀）
- Dev (°C)（自動計算 = Sim - Meas）
- Dev (%)（自動計算 = (Sim - Meas) / Meas × 100）
- 判斷（自動）：|Dev%| ≤ 10% → ✅ 綠，10~20% → ⚠️ 黃，> 20% → ❌ 紅
- 備註（文字輸入）

【選取元件功能】
頁面右上方「從數據頁選取元件」按鈕：
- 點擊後彈出 Modal（glass 樣式）
- Modal 中列出所有 Module 4b 的元件（顯示：類別 + 元件名稱）
- 使用者勾選想要比對的元件（通常只選 PA、FPGA 等關鍵元件）
- 確認後，被選元件自動帶入比對表，Sim Tc 欄留空等待輸入

【下方：模擬條件備註】
- 一行可編輯文字區（placeholder：「請輸入模擬條件說明，如邊界條件假設、功耗設定...」）

━━━ Firestore ━━━
pages/{index}/ {
  type:"sim_vs_meas", order:N,
  data:{
    title,
    sim_image, meas_image,
    sim_note,
    items:[{ component_name, category, tc_derated, sim_tc, meas_tc, note }]
  }
}

左側列表：「📉 比對頁」

完成後確認：圖片可插入、選取元件後自動帶入、Dev 自動計算顏色正確。
```

---

## ╔══ SESSION 10 ══╗
## 報告書首頁（歷史報告列表）+ 最終整合測試

```
在現有 index.html 基礎上，新增報告書管理首頁，並做最終整合測試。

━━━ 報告書首頁 ━━━
工具首次開啟（或點擊 Toolbar 的「報告列表」按鈕）時，顯示報告管理頁：

頁面樣式：深色 Liquid Glass 風格（不是 A4 白底）

顯示從 Firestore thermal_reports collection 讀取的所有報告卡片：
每張卡片（glass card 樣式）顯示：
- 案名（project_name）
- Stage badge
- 日期
- 最後編輯時間（updated_at，顯示「N 天前」或具體日期）
- 按鈕：[開啟編輯] [複製] [刪除]

右上角「+ 新增報告」按鈕：
- 彈出 Modal 輸入案名、Stage、日期（最少需要案名）
- 確認後建立新 Firestore document，進入編輯介面（預設帶入一個空封面頁）

刪除確認 Dialog（glass 樣式）：
「確定刪除「{案名}」嗎？此操作無法復原。」[取消] [確認刪除]
刪除後同時清除 Firebase Storage 中該報告的圖片。

━━━ 整合測試清單（完成後逐一確認）━━━
□ 首頁可新增報告、開啟報告、刪除報告
□ Module 1 封面頁所有欄位可輸入，圖片可貼上，自動儲存正常
□ Module 2 圖片頁 1~4 張動態排版正確，Ctrl+V 貼圖有效
□ Module 6 結論頁四個區塊可輸入
□ 頁面列表可拖曳排序
□ 預覽模式可切換頁面，ESC 退出
□ PDF 匯出後格式正確（A4 尺寸，頁面順序正確）
□ 離線時（斷網）仍可操作，重新連線後自動同步
□ Firestore 中資料結構與 SPEC 定義一致

如有任何測試項目失敗，請逐一修復後再回報。
```

---

## 執行順序總覽

| Session | 內容 | Phase | 預估完成時間 |
|---------|------|-------|------------|
| 1 | 骨架 + CSS + Firebase | 1 | 快 |
| 2 | Module 1 封面頁 | 1 | 中 |
| 3 | Module 2 圖片頁 | 1 | 中 |
| 4 | Module 6 結論頁 | 1 | 快 |
| 5 | 排序 + 預覽 + PDF | 1 | 中 |
| 6 | Module 3 標註頁 | 2 | 慢（SVG 複雜）|
| 7 | Module 4a Header | 2 | 快 |
| 8 | Module 4b 數據表 | 2 | 慢（動態欄複雜）|
| 9 | Module 5 比對頁 | 2 | 中 |
| 10 | 首頁 + 整合測試 | 2 | 中 |

## 使用注意事項

1. **每個 Session 完成後先確認功能正常，再進行下一段**
2. **Session 6（標註頁）最複雜**，如果卡住可以先跳過，做 7→8→9→10，最後再回來做 6
3. **如果 Claude Code 開始重複說「我來開始」但沒有動作**，直接 Esc 中斷，重新貼同一個 prompt
4. **每個 Session 的 prompt 可以直接複製貼上**，不需要額外說明
