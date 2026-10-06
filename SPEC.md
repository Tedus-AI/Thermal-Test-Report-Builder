# SPEC v1.2 — 通用型熱流實驗報告書產生器
**Thermal Test Report Builder**
**定稿日期：2026-03-20**

---

## 目錄

1. [產品定位與使用情境](#1-產品定位與使用情境)
2. [整體 UI 架構](#2-整體-ui-架構)
3. [頁面模組規格](#3-頁面模組規格)
   - [Module 1：封面頁](#module-1封面頁-cover-page)
   - [Module 2：圖片頁](#module-2圖片頁-image-page)
   - [Module 3：量測點標註頁](#module-3量測點標註頁-monitor-point-annotation)
   - [Module 4：實驗數據頁](#module-4實驗數據頁-experiment-data-page)
   - [Module 5：模擬 vs 量測比對頁](#module-5模擬-vs-量測比對頁-sim-vs-meas)
   - [Module 6：實驗結論頁](#module-6實驗結論頁-conclusion-page)
   - [Module 7：比較頁](#module-7比較頁-comparison-page)
   - [Module 8：目錄頁](#module-8目錄頁-table-of-contents)
4. [Firebase 資料架構](#4-firebase-資料架構)
5. [全域功能規格](#5-全域功能規格)
6. [Design System — Liquid Glass UI](#6-design-system--liquid-glass-ui)
7. [開發階段規劃](#7-開發階段規劃)
8. [技術依賴清單](#8-技術依賴清單)
9. [待處理事項（Post-Phase 1）](#9-待處理事項post-phase-1)

---

## 1. 產品定位與使用情境

| 項目 | 內容 |
|------|------|
| **目標用戶** | 熱流工程師（個人與團隊）|
| **核心任務** | 將熱流量測數據、TC 標註照片、IR 圖片組裝成一份正式電子報告書 |
| **使用頻率** | 每個專案 Prototype / EVT / DVT / PVT 各一份，中高頻使用 |
| **部署方式** | GitHub Pages（GitHub Actions `pages.yml` 部署並蓋上建置版本號；單一 `index.html`，無後端）|
| **技術限制** | 無 Python、無後端、純瀏覽器執行，公司防火牆限制 |
| **資料持久化** | 本機 JSON 資料庫檔案（File System Access API，可放共用磁碟）＋ 每日自動備份資料夾（保留 30 份）；可選 **SharePoint 雙存檔**（`spSync.js`，見 §4.1）。原規劃的 Firebase 已停用，見 §4 |
| **輸出格式** | PDF（Phase 1）/ PPTX（Phase 2）|

---

## 2. 整體 UI 架構

```
┌──────────────────────────────────────────────────────────────┐
│  🔧 Toolbar                                                   │
│  [+ 新增頁面 ▾]  [預覽]  [匯出 PDF]  [匯出 PPTX]  [報告列表] │
├──────────────────┬───────────────────────────────────────────┤
│  📋 左側頁面列表  │                                           │
│  (固定寬度 220px) │         主編輯區 / 即時預覽               │
│                  │         (A4 直向 / 橫向 依模組而定)        │
│  ┌─────────────┐ │                                           │
│  │ 🏠 封面頁   │ │                                           │
│  ├─────────────┤ │                                           │
│  │ 🖼 圖片頁   │ │                                           │
│  ├─────────────┤ │                                           │
│  │ 📍 標註頁   │ │                                           │
│  ├─────────────┤ │                                           │
│  │ 📊 數據頁   │ │                                           │
│  ├─────────────┤ │                                           │
│  │ 📉 比對頁   │ │                                           │
│  ├─────────────┤ │                                           │
│  │ 📝 結論頁   │ │                                           │
│  └─────────────┘ │                                           │
│  ↕ 拖曳排序       │                                           │
└──────────────────┴───────────────────────────────────────────┘
```

### UI 操作規則

| 功能 | 說明 |
|------|------|
| 新增頁面 | 點 `+ 新增頁面 ▾` 下拉，選擇模組類型 |
| 刪除頁面 | 右鍵選單 / 頁面列表刪除按鈕 + 確認 Dialog |
| 拖曳排序 | 左側列表 drag-to-reorder，放開後自動存檔 |
| 複製頁面 | 同類型頁面快速複製（如多個圖片頁）|
| 自動存檔 | 任何欄位變更後 debounce 1000ms 自動寫入 Firestore |
| 狀態列 | 底部顯示「已儲存 ✅ / 儲存中… / 離線模式 ⚠️」|

---

## 3. 頁面模組規格

---

### Module 1：封面頁（Cover Page）

**方向：A4 直向**

#### 欄位規格

| 欄位 | 型態 | 說明 |
|------|------|------|
| 案名（Project Name）| 文字輸入 | 大字顯示，置中，字體最大 |
| 產品型號（Model）| 文字輸入 | |
| 測試階段（Stage）| 下拉選單 | `Prototype / EVT / DVT / PVT / MP` |
| 實驗人員（Tested By）| 文字輸入 | 多人以逗號分隔 |
| 日期（Date）| Date Picker | 預設帶入今日 |
| 部門 / 公司（Dept.）| 文字輸入 | |
| 封面圖（Product Photo）| 拖拉 / 貼上 / 選檔 | 置中顯示，可縮放 |
| 版本號（Report Version）| 文字輸入 | 如 `v1.0`，預設 `v1.0` |

#### 視覺佈局

```
┌────────────────────────────────────┐
│                                    │
│         [公司 / 部門名稱]           │
│                                    │
│    ┌──────────────────────────┐    │
│    │      [封面圖片]           │    │
│    └──────────────────────────┘    │
│                                    │
│         [案名 — 大字]              │
│         [產品型號]                  │
│                                    │
│  Stage: [DVT]   Version: [v1.0]   │
│  Date:  [2026-03-20]               │
│  Tested By: [Engineer Name]        │
│                                    │
└────────────────────────────────────┘
```

---

### Module 2：圖片頁（Image Page）

**方向：A4 橫向**

#### 佈局邏輯（2×2 四象限，動態排版）

```
┌──────────────────────────────────────────────┐
│  [可鍵入標題 — Placeholder: 點此輸入標題]     │
├─────────────────────┬────────────────────────┤
│                     │                        │
│    [左上 圖片]      │      [右上 圖片]        │
│                     │                        │
│    [左上 說明文字]  │      [右上 說明文字]    │
├─────────────────────┼────────────────────────┤
│                     │                        │
│    [左下 圖片]      │      [右下 圖片]        │
│                     │                        │
│    [左下 說明文字]  │      [右下 說明文字]    │
└─────────────────────┴────────────────────────┘
```

#### 動態排版規則

| 圖片數量 | 排版方式 |
|---------|---------|
| 1 張 | 標題下方全版單張，置中，佔滿可用空間 |
| 2 張 | 左上 + 右上，各佔半版 |
| 3 張 | 左上 + 右上 + 左下，右下顯示 `+` 新增 Placeholder |
| 4 張 | 完整 2×2 四象限 |

#### 圖片操作規格

| 規格項目 | 說明 |
|---------|------|
| 插入方式 | 拖拉 / 選檔（`<input type=file>`）/ **Ctrl+V 貼上** |
| 圖片說明 | 每張圖下方一行可編輯文字，灰色虛線框 Placeholder 提示 |
| 標題 | 頁面頂部可編輯，Placeholder 提示 |
| 替換圖片 | 點擊圖片顯示浮動工具列 → 替換 / 刪除 |
| Placeholder | 未放圖區域顯示虛線框 + `點此或拖拉圖片` 提示 |

> **💡 適用場景：** IR 熱像圖、TC 接線實照、設備安裝圖、Heatsink 近照、FloTHERM 截圖、測試腔體環境照

---

### Module 3：量測點標註頁（Monitor Point Annotation）

**方向：A4 橫向**

#### 核心互動流程

```
Step 1  上傳 / 貼上 PCB 或設備照片
Step 2  點擊照片上任意位置 → 產生 [●] 標記點 + 自動編號
Step 3  從標記點拖曳 → 引線延伸至照片四周空白區
Step 4  放開滑鼠 → 產生可鍵入標籤框
Step 5  鍵入元件名稱（格式建議：TC1 - PA_GaN_U1）
Step 6  可移動標籤框位置 / 刪除標記點 / 刪除標籤框
```

#### 頁面佈局

```
┌──────────────────────────────────────────────────────────┐
│  [標題：TC Thermocouple Placement]                        │
│                                                          │
│  ┌──────┐  ┌────────────────────────┐  ┌─────────────┐  │
│  │標籤區│  │                        │  │   標籤區    │  │
│  │(左側)│  │     PCB / 設備照片     │  │   (右側)    │  │
│  │      │  │   ① ②                 │  │             │  │
│  │TC1←──┼──┼──●  ●──────────────── ┼──┼──→TC2       │  │
│  │PA_U1 │  │        ③              │  │  FPGA_U1    │  │
│  │      │  │         ●             │  │             │  │
│  └──────┘  └────────────────────────┘  └─────────────┘  │
│  ┌──────────────────────────────────────────────────┐    │
│  │  標籤區 (下方)                                    │    │
│  │  TC3 - DDR_U5                                    │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

#### 元件規格

| 規格項目 | 說明 |
|---------|------|
| 照片插入 | 拖拉 / 選檔 / 貼上 |
| 標記點 | 紅色實心圓點 + 白色數字編號（1, 2, 3…）自動遞增 |
| 引線 | SVG 折線，從標記點連到標籤框，不可被截斷 |
| 標籤框 | 白底黑框，可自由移動，點擊可編輯 |
| 標籤內容 | 建議格式：`TC# - 元件名稱`，如 `TC1 - PA_GaN_U1` |
| 元件類型 Tag | 可選附加：`PA / FPGA / DDR / DC-DC / Connector`（選填）|
| 匯出時 | 照片 + 標記點 + 引線 + 標籤框合併為單一圖層輸出 |
| 刪除操作 | 右鍵標記點 → 刪除（連同對應引線與標籤框一起移除）|

---

### Module 4：實驗數據頁（Experiment Data Page）

**方向：A4 直向**

---

#### 4a. 實驗條件 Header（頁頂固定區塊）

| 欄位 | 型態 | 說明 |
|------|------|------|
| 實驗日期（Test Date）| Date Picker | 預設今日 |
| 產品 Stage | 下拉 | 與封面頁 Module 1 Stage 同步 |
| 軟體版本（SW Version）| 文字 | |
| Waveform 版本（Waveform Ver.）| 文字 | |
| 熱平衡時間（Thermal Equilibrium Time）| 數字 + 單位（min）| |
| 產品安裝方式（Mounting）| 下拉 + 自訂 | `Pole Mount / Wall Mount / Free-standing / Custom` |
| 環境溫度條件（Ta Conditions）| 多值輸入 | 可新增多個 Ta（如 `25°C`、`55°C`），預設兩個 |
| 測試地點（Location）| 文字 | `Lab / Chamber / Outdoor / Custom` |

> **Ta 條件說明：** 使用者在 Header 定義幾個量測環境溫度，數據表自動展開對應欄位組。預設為 `Ta = 25°C` 和 `Ta = 55°C`。

---

#### 4b. 量測數據表

**量測對象：Case Temperature（Tc）only，不量 Tj。**

##### 固定欄（左側，每列必填）

| 欄 | 欄位名稱 | 型態 | 說明 |
|---|---------|------|------|
| A | 類別 | 下拉 | `RF / Digital / PWR` |
| B | # | 自動編號 | 同類別內自動遞增，如 RF-1, RF-2 |
| C | 元件名稱 | 文字 | 如 `PA_GaN_U1`、`FPGA_U1` |
| D | Spec Type | 下拉 | `Recommended / Absolute` |
| E | Tc Spec (°C) | 數字 | Case temperature 規格上限 |
| F | Derating Factor | 下拉 | `0.80 / 0.85 / 0.90 / 0.95 / 1.00`，**預設 0.90** |
| G | Tc Spec Derated (°C) | **自動計算** | `= E × F`，唯讀 |
| H | TIM Type | 文字 | 如 `Coolzorb K=11.5`、`TIM Pad`、`None` |

##### 動態欄（每個 Ta 條件自動展開 × 2 欄）

| 欄組 | 欄位 | 型態 | 說明 |
|------|------|------|------|
| 每個 Ta 條件 | 實測 Tc (°C) | 數字輸入 | TC 量測值，手動輸入 |
| 每個 Ta 條件 | Margin (%) | **自動計算** | `= (G - 實測Tc) / G × 100`，顏色警示 |

##### 結尾欄

| 欄位 | 型態 | 說明 |
|------|------|------|
| Pass / Fail | **自動判斷** | 所有 Ta 條件中任一 ❌ → Fail |
| 備註 | 文字 | 自由輸入 |

##### Margin 顏色警示規則

| Margin 值 | 狀態 | 欄位背景色 |
|----------|------|----------|
| ≥ 10% | ✅ Pass | 綠色 |
| 0% ~ 10% | ⚠️ Warning | 黃色 |
| < 0% | ❌ Fail | 紅色 |

> **Pass/Fail 邏輯：** 任一 Ta 條件下 Margin < 0% → 整列 Pass/Fail 欄顯示 ❌ Fail，該列整行背景變淡紅。
> 所有 Ta 都沒有量測值的列顯示「—」（未量測），**不判定為 Pass**；停用（斷線）列顯示「斷線 N/A」且不參與判定。

##### Margin 定義（數據頁與 PDF 皆印出此定義）

| 項目 | 公式 |
|------|------|
| Derated Tc | `Tc Spec × Derating` |
| Margin (%) | `(Derated Tc − Tc實測) / Derated Tc × 100`（判定依據）|
| ΔT Margin (°C) | `Derated Tc − Tc實測`（與 % 一併顯示於 Margin 格第二行，供工程判讀）|

##### 數據表示意（預設 25°C + 55°C）

```
│類別│ # │  元件名稱  │Spec│Drt│Derated│  TIM  │Tc@25°C│Mgn  │Tc@55°C│Mgn  │P/F│備註│
│ RF │ 1 │PA_GaN_U1   │130 │0.9│  117  │CZ K11 │ 75.2  │ 36% │ 99.1  │ 15% │ ✅│    │
│ RF │ 2 │PA_GaN_U2   │130 │0.9│  117  │CZ K11 │ 73.1  │ 37% │ 97.3  │ 17% │ ✅│    │
│Digi│ 1 │FPGA_U1     │100 │0.9│   90  │Pad    │ 65.4  │ 27% │ 89.2  │  1% │⚠️│    │
│ PWR│ 1 │DC-DC_U3    │125 │1.0│  125  │None   │ 52.0  │ 58% │ 74.2  │ 41% │ ✅│    │
```

---

#### 4c. Embedded Sensor 讀值（選用子區塊，可收合）

用於記錄板上 on-chip sensor 讀值，與 TC 量測分開管理。

| 欄位 | 型態 | 說明 |
|------|------|------|
| Sensor 名稱 | 文字 | 如 `FPGA_U1`、`PA_ADMV49281_1` |
| Sensor 類型 | 下拉 | `Tj only / Tj+Tc (CPU type)` |
| 各 Ta 讀值 | 文字 | 單值（如 `88.3`）或雙值（如 `72.1 / 78.4`，格式 Tj/Tc）|
| 備註 | 文字 | |

---

### Module 5：模擬 vs 量測比對頁（Sim vs Meas）

**方向：A4 橫向**

#### 設計邏輯

```
Module 4b（使用者選定的比對 Ta，預設 55°C；無 55°C 時預設為最高 Ta）
        ↓ 自動帶入（元件名 + 該 Ta 的實測 Tc）
Module 5 比對表
        ↓ 使用者手動填入 Sim Tc（從 FloTHERM Monitor Point 抄入）
        ↓ 自動計算 Dev(°C) 與 Dev(%)
顏色警示（Acceptable / Review / Check Model）
```

#### 元件選取流程

```
Step 1  進入 Module 5 頁面
Step 2  點選「從 Module 4b 選取元件」按鈕
Step 3  彈出 Checklist：列出 Module 4b 所有元件
Step 4  使用者勾選關鍵元件（如 PA × N 顆、FPGA 等）
Step 5  確認後自動帶入：元件名稱 + Tc Spec Derated + Meas Tc @ 比對 Ta
        （以「數據頁 id + 元件 uid」連結來源元件；改名、重排、刪除都不會錯接。
          來源元件被刪除時該列顯示「⚠ 來源元件已變更」，不會改抓其他元件的數值）
        （比對 Ta 可在頁面右上角切換；來源數據頁沒有該 Ta 時顯示「無此 Ta」，不會改用其他 Ta 的讀值）
Step 6  Sim Tc 欄留空，等待手動填入
```

#### 欄位規格

| 欄 | 欄位名稱 | 來源 | 說明 |
|---|---------|------|------|
| A | 類別 | Module 4b 自動帶入 | 唯讀 |
| B | 元件名稱 | Module 4b 自動帶入 | 唯讀 |
| C | Tc Spec Derated (°C) | Module 4b 自動帶入 | 唯讀，參考用 |
| D | **Sim Tc @ 比對 Ta (°C)** | **手動輸入** | 從 FloTHERM Monitor Point 抄入 |
| E | **Meas Tc @ 比對 Ta (°C)** | Module 4b 自動帶入 | 唯讀 |
| E' | **Meas ΔT (°C)** | 自動計算 | `= E − Ta`（量測溫升）|
| F | **Dev (°C)** | 自動計算 | `= D - E`，正值代表 Sim 高估 |
| G | **Dev (%)** | 自動計算 | `= (D − E) / (E − Ta) × 100`（**以溫升為基準**；溫升 ≤ 0 時不計算 %）|
| H | 判斷 | 自動 | 依 Dev% 顏色警示（見下方）|
| I | 備註 | 手動輸入 | 如：模擬假設差異、量測點位置說明 |

#### Dev 顏色警示規則

| 條件（取 % 與絕對溫差中較寬鬆者）| 判斷 | 顏色 |
|----------|------|------|
| \|Dev%\| ≤ 10% **或** \|Dev\| ≤ 2°C | ✅ Acceptable | 綠色 |
| \|Dev%\| ≤ 20% **或** \|Dev\| ≤ 4°C | ⚠️ Review | 黃色 |
| 其餘 | ❌ Check Model | 紅色 |

> **為何以溫升為基準：** CFD 預測的是溫升 ΔT = P × Rth，Ta 是邊界條件。以 °C 溫度當分母時，同樣的模型誤差在 Ta 越高時 % 越小（例：誤差 3°C、溫升 44°C，Ta=25 時 4.3%、Ta=55 時 3.0%）；以溫升為分母則固定為 6.8%，直接反映功耗 / 熱阻建模誤差。
> **與絕對溫差的對照：** ±10% ≈ ±(0.1 × Meas ΔT)°C。Meas ΔT = 20 / 30 / 40 / 50 / 60°C 時，±10% 約 ±2 / 3 / 4 / 5 / 6°C；±20% 約 ±4 / 6 / 8 / 10 / 12°C。
> **2°C / 4°C 下限：** 對應熱電偶量測不確定度（約 ±1~2°C），避免低溫升元件因 1~2°C 差異被誤判。
> 判定規則與公式以備註 1、3、4 印在比對頁與 PDF 上；滑鼠移到 Dev(%) 格會顯示該列 ✅ / ⚠️ 對應的 ±°C 範圍。

> **注意：** Dev 為負值（Sim 低估實測）比正值更危險，建議在備註欄說明低估原因。

#### 頁面佈局

```
┌───────────────────────────────────────────────────────────┐
│  [標題：Simulation vs. Measurement — Ta = 55°C]            │
│                                      [選取元件 按鈕]        │
├───────────────────────────┬───────────────────────────────┤
│  FloTHERM 結果截圖         │  IR / TC 量測照片              │
│  [圖片插入區]              │  [圖片插入區]                  │
│  [說明文字]                │  [說明文字]                    │
├───────────────────────────┴───────────────────────────────┤
│ 類別│元件名稱  │Derated│Sim Tc│Meas Tc│Dev °C│Dev % │判斷│備註│
│ RF  │PA_GaN_U1│  117  │102.1 │  99.1 │ +3.0 │ +3.0%│ ✅│    │
│ RF  │PA_GaN_U2│  117  │ 98.5 │  97.3 │ +1.2 │ +1.2%│ ✅│    │
│ Digi│FPGA_U1  │   90  │ 95.3 │  89.2 │ +6.1 │ +6.8%│ ✅│    │
├───────────────────────────────────────────────────────────┤
│  模擬條件備註：[可鍵入 — 邊界條件假設、太陽輻射設定、功耗等]  │
└───────────────────────────────────────────────────────────┘
```

---

### Module 6：實驗結論頁（Conclusion Page）

**方向：A4 直向**

| 區塊 | 型態 | 說明 |
|------|------|------|
| 結論摘要（Summary）| 富文本 | 支援粗體 / 條列 |
| Result by Test Condition | 自動 | **每個數據頁 = 一個測試條件**，逐頁列出結果（❌ FAIL / ⚠️ CONDITIONAL PASS / ✅ PASS / 尚未判定）與 Fail · Warning · 未量測數 |
| 合規性總表 | 從數據頁選取 | **依數據頁分組**顯示：元件 / **Max Tc（所有 Ta 中最高的實測值，並標示其 Ta）** / Derated Spec / Margin（% 與 ΔT°C）/ 判斷。PDF 過長時自動續頁 |
| Overall Result | 自動 | 各測試條件中最差者：任一 Fail → ❌ FAIL；否則任一 Warning → ⚠️ CONDITIONAL PASS；全部 Pass → ✅ PASS；皆無量測值 → 尚未判定 |
| 未列入提示 | 自動 | 合規性總表未列入的 Fail / Warning 元件**依數據頁分組**提示；可點單一元件加入、或「加入此頁全部」；提示框可按 ✕ 關閉，並可用「顯示未列入的 Fail / Warning」按鈕重新叫出 |
| 元件選取視窗 | — | 每個元件旁顯示 ❌ Fail / ⚠️ Warning / ✔ Pass（含最差 Margin 與其 Ta）、未量測、斷線 N/A；數據頁標題列顯示 Fail / Warning 數；「勾選 Fail / Warning」一鍵勾選 |
| 發現問題（Issues Found）| 條列輸入 | 每條一行，可新增 / 刪除 |
| 後續行動（Next Action）| 條列輸入 | 每條附 Owner 欄 + Due Date 欄 |

---

### Module 7：比較頁（Comparison Page）

**方向：A4 橫向**　用途：同一份報告不同測試條件的元件溫度比較（例：RF 補償前後、不同風扇轉速），
或跨報告比較同一顆元件（例：EVT vs DVT）。

| 項目 | 規格 |
|------|------|
| 比較對象 | 最多 4 個，每個是一個數據頁：本報告的數據頁，或資料庫中**其他報告**的數據頁（下拉選單依報告分組，顯示 Stage · 案名 · 數據頁 n · 測試條件）。第一個 = 基準，可上移 / 移除 / 改表頭名稱。新增比較頁時預設帶入本報告的數據頁 |
| 比較 Ta | 所有對象 Ta 的聯集；預設 55°C（所有對象都有時），否則取共同的最高 Ta；部分對象沒有的 Ta 標示「部分對象沒有」，該格顯示「無此 Ta」 |
| 表格 | 類別 / 元件名稱 / Derated Tc / 每個對象的 Tc（依各自的 Derated Spec 標 Fail 紅底、Warning 黃底；斷線顯示「斷線」）/ 每個比較對象的 ΔTc = 比較 Tc − 基準 Tc（負 = 降溫綠色、正 = 升溫紅色、\|ΔTc\| < 0.5°C 灰色） |
| 對應方式 | 依元件名稱（不分大小寫、空白正規化）；只在部分對象出現的元件也列出，ΔTc 顯示「—」 |
| 排序 | 依基準順序，或依最後一個比較對象的 \|ΔTc\| 由大到小 |
| 摘要 | 每個比較對象一行：平均 ΔTc（n 顆）、降溫最多、升溫最多；同時寫入「✨ 產生結論草稿」（【比較】） |
| 快照 | 其他報告的對象保存加入時的數值快照（每次開啟比較頁時以來源最新值更新）。來源報告被刪除或不在同事的資料庫時，比較頁與 PDF 仍以快照顯示並標示「快照」 |
| PDF | 每頁 18 列，自動續頁；備註與摘要印在最後一頁 |
| 範本 | 以既有報告為範本時，比較頁指向本報告數據頁的對象會改指向新報告對應的數據頁 |

### Module 8：目錄頁（Table of Contents）

**方向：A4 橫向**　「新增頁面 → 📑 目錄頁」插在封面後。每個報告頁一行（封面、目錄本身、備註頁除外）：
圖片頁 / 標註頁用標題、數據頁「Thermal Test Data — 測試條件」、比對頁「Simulation vs Measurement — Ta」、比較頁用比較標題、結論頁「Test Conclusion」。
頁碼為該頁在 PDF 的起始頁（封面 = 1），依實際預覽 / 匯出的頁面計算：一個數據頁跨多頁、或只匯出部分頁面時都會重算。超過 16 項時分兩欄。標題可改（預設 CONTENTS）。

---

## 4. Firebase 資料架構（已停用，保留供參考）

> **現況：** 目前版本使用本機 JSON 資料庫檔案（`fileDb.js`）：
> `{ thermal_reports: { [reportId]: { ...meta, pages: { "0": { id, type, order, data, updated_at }, ... } } }, tim_library }`。
> 每頁有持久化的 `id`；數據頁元件有 `uid`，比對頁 / 結論頁以 `source_page + source_uid` 連結來源元件。
> 寫入採單一佇列合併寫入；檔案被其他分頁 / 使用者修改時會停止儲存並提示，不會覆蓋；JSON 毀損時拒絕開啟。

### 4.1 SharePoint 雙存檔（`spSync.js`）

與 Project-TIM-management-tool 共用同一個 Azure 應用程式與 `Thermal-Spec-DB` 網站。本機資料庫檔案仍是工作檔；
每次本機存檔後約 4 秒，**只上傳有變更的報告**到 SharePoint，並每 60 秒拉回同事改過的報告。

```
Thermal-Spec-DB → 文件（Shared Documents）
└── Thermal_Report_Builder/
    ├── Database/
    │   ├── reports/<reportId>.json   每份報告一個檔（{ format: 'thermal-report-v1', id, report }）
    │   └── tim_library.json          共用 TIM 材料庫（{ format: 'thermal-tim-library-v1', tim_library }）
    ├── Backup/                       thermal_reports_backup_YYYY-MM-DD.json（每日一份，保留 30 份）
    └── Reports/<案名>_<Stage>/       匯出 PDF 時可勾選「同時上傳到 SharePoint」
```

| 情境 | 行為 |
|---|---|
| 同步狀態 | 寫在本機資料庫檔 `sp_sync`（dirty / deleted / eTag），重新整理或離線後仍會補傳 |
| 兩人改了同一份報告 | 以 If-Match（eTag）寫入；SharePoint 上已被別人改過 → 你的版本寫入，對方版本另存「（衝突副本 · 對方 · 時間）」報告，並跳出提示 |
| 正在編輯的報告被別人改 | 編輯中不替換畫面；離開編輯器後才套用 |
| 本機刪除、SharePoint 上已被改過 | 不刪，改為還原到本機 |
| TIM 材料庫 | 兩邊新增的材料合併（同名以本機為準） |
| 斷線 / 登入過期 | 工具列顯示「未同步」/「請重新登入」，修改保留在本機，恢復後自動補傳 |

登入回傳頁：Azure 只接受已登記的重新導向 URI。在 `https://tedus-ai.github.io/` 上沿用 TIM 工具已登記的
`https://tedus-ai.github.io/Project-TIM-management-tool/auth.html`（同網域，MSAL 可讀取彈出視窗 / 靜默更新 iframe 的結果），不需改 Azure；
其他網址（例如 `http://localhost:<port>/`）使用工具旁的 `auth.html`，需在 Azure **應用程式註冊 → 驗證 → SPA 重新導向 URI** 登記。
使用者需要 `Thermal-Spec-DB` 網站的編輯權限。網站、資料夾路徑在 `spSync.js` 的 `CONFIG`。

### 專案設定

> **待確認：** 沿用現有 Volume-Evaluation-Tool 的 Firebase 專案，還是新建獨立專案？

### Firestore 結構

```
firestore/
└── thermal_reports/
    └── {report_id}/
        ├── meta
        │   ├── project_name      (string)
        │   ├── model             (string)
        │   ├── stage             (string)  Prototype/EVT/DVT/PVT/MP
        │   ├── tested_by         (string)
        │   ├── date              (string)  ISO format
        │   ├── dept              (string)
        │   ├── report_version    (string)  v1.0
        │   └── updated_at        (timestamp)
        │
        ├── pages/               ← 頁面陣列（有序）
        │   ├── 0/
        │   │   ├── type          (string)  "cover"
        │   │   ├── order         (number)  排序索引
        │   │   └── data          (object)  各模組欄位
        │   ├── 1/
        │   │   ├── type          (string)  "image"
        │   │   ├── order         (number)
        │   │   └── data
        │   │       ├── title     (string)
        │   │       └── images[]
        │   │           ├── position   (string)  "top-left/top-right/bottom-left/bottom-right"
        │   │           ├── url        (string)  Firebase Storage URL
        │   │           └── caption    (string)
        │   ├── 2/
        │   │   ├── type          (string)  "annotation"
        │   │   └── data
        │   │       ├── title     (string)
        │   │       ├── photo_url (string)
        │   │       └── markers[]
        │   │           ├── id         (number)
        │   │           ├── x, y       (number)  照片內座標（百分比）
        │   │           ├── label      (string)  TC1 - PA_GaN_U1
        │   │           ├── label_x, label_y (number) 標籤框位置
        │   │           └── component_type   (string)  選填
        │   ├── 3/
        │   │   ├── type          (string)  "data"
        │   │   └── data
        │   │       ├── header    (object)  實驗條件
        │   │       ├── ta_conditions[]     (number[]) [25, 55]
        │   │       ├── components[]
        │   │       │   ├── category       (string)  RF/Digital/PWR
        │   │       │   ├── name           (string)
        │   │       │   ├── spec_type      (string)
        │   │       │   ├── tc_spec        (number)
        │   │       │   ├── derating       (number)  0.9
        │   │       │   ├── tim_type       (string)
        │   │       │   └── measurements[] (object[]) [{ta:25, tc:75.2}, {ta:55, tc:99.1}]
        │   │       └── sensors[]          Embedded sensor 讀值
        │   ├── 4/
        │   │   ├── type          (string)  "sim_vs_meas"
        │   │   └── data
        │   │       ├── title     (string)
        │   │       ├── sim_image_url    (string)
        │   │       ├── meas_image_url   (string)
        │   │       ├── sim_condition    (string)  備註
        │   │       └── items[]
        │   │           ├── component_name (string)  從 Module 4b 帶入
        │   │           ├── tc_derated     (number)  從 Module 4b 帶入
        │   │           ├── sim_tc         (number)  手動輸入
        │   │           ├── meas_tc        (number)  從 Module 4b 帶入（Ta=55°C）
        │   │           └── note           (string)
        │   └── 5/
        │       ├── type          (string)  "conclusion"
        │       └── data
        │           ├── summary   (string)  富文本（HTML 或 Markdown）
        │           ├── issues[]  (string[])
        │           └── actions[]
        │               ├── action  (string)
        │               ├── owner   (string)
        │               └── due     (string)
        │
        └── (images 存於 Firebase Storage，路徑：reports/{report_id}/...)
```

### 圖片儲存策略

| 條件 | 儲存方式 |
|------|---------|
| 圖片 < 500KB | Base64 直接存入 Firestore document |
| 圖片 ≥ 500KB | 上傳至 Firebase Storage，存 URL |

### 資料操作行為

| 操作 | 說明 |
|------|------|
| 自動儲存 | 任何欄位變更後 debounce 1000ms 寫入 Firestore |
| 離線保護 | 啟用 `enableIndexedDbPersistence()`，離線時仍可操作 |
| 報告列表 | 首頁顯示所有歷史報告，依 `updated_at` 排序，可載入繼續編輯 |
| 新增報告 | 建立新 document，生成唯一 `report_id` |
| 刪除報告 | 需確認 Dialog，連同 Firebase Storage 圖片一併刪除 |

---

## 5. 全域功能規格

### 匯出功能

| 功能 | Phase | 技術方案 | 說明 |
|------|-------|---------|------|
| 匯出 PDF | **Phase 1** | html2canvas + jsPDF | 每頁截圖合併 |
| 匯出 PPTX | Phase 2 | PptxGenJS | 每頁模組 → 一張投影片 |
| 預覽模式 | Phase 1 | 全螢幕 Slide Show | 鍵盤左右鍵切換頁面 |

### PDF 匯出規則

| 規則 | 說明 |
|------|------|
| 頁面尺寸 | A4（297×210mm 橫向 / 210×297mm 直向，依各模組設定）|
| 圖片品質 | html2canvas scale: 2（@2x 解析度，避免模糊）|
| 頁面順序 | 依左側列表排序 |
| 檔名預設 | `{ProjectName}_{Stage}_{Date}_ThermalReport.pdf` |

### 匯出前報告檢查

匯出視窗頂端列出可能漏填的項目（⚠ 待確認 / ℹ 提醒），點項目即關閉視窗並跳到該頁：封面缺案名 / 型號 / Tested by / 圖片；
圖片頁無圖、標註頁無照片或標註點；數據頁未命名、未填 Tc Spec、各 Ta 未填實測值、機台功耗、Test Date、匯入時未達穩態；
比對頁未選元件、缺 Sim Tc、來源已變更、無此 Ta、未填結論敘述；比較頁少於 2 個對象、找不到來源、使用快照；結論頁未填結論、Fail / Warning 未列入 Compliance、有 Fail 但 Issues 空白。
SharePoint 已啟用時可勾選「同時上傳到 SharePoint」（`Thermal_Report_Builder/Reports/<案名>_<Stage>/`）。

### 報告書首頁（報告列表）

| 功能 | 說明 |
|------|------|
| 顯示內容 | 案名、型號、Stage、整體判定徽章（依所有數據頁計算：✓ PASS / ⚠ CONDITIONAL / ✕ FAIL）、日期、頁數、最後編輯時間；SharePoint 衝突副本另有標記 |
| 搜尋 / 篩選 / 排序 | 搜尋案名 / 型號（`/` 快速聚焦、Enter 開啟第一筆）；Stage 篩選；最近編輯 / 建立日期 / 案名排序（記住選擇）|
| 操作 | 點卡片開啟 / 當範本新增 / 複製 / 刪除 |
| 新增 | 「+ 新增報告」：案名、型號、Stage、日期，起始內容選 **標準架構**（封面、圖片、標註、數據、比對、結論）、**只有封面**、或 **以既有報告為範本**（沿用頁面、元件、規格、Ta 條件、記錄器通道對應，可選保留圖片；清空實測值、功耗、模擬值、結論；備註頁不帶入）|

### 效率工具

| 功能 | 位置 | 說明 |
|------|------|------|
| 記錄器 CSV 匯入 | 數據頁按鈕 / 拖放檔案 | `loggerCsv.js` 解析（逗號 / 分號 / Tab、引號、單位、`OVER` 等錯誤值、跨午夜）；每通道取最後 N 分鐘（無時間欄時最後 N 筆）平均；區間溫差 ≤ 門檻視為穩態並顯示趨勢 °C/min；依上次對應 → 通道名稱 → 順序自動配對；環溫通道自動辨識並選最接近的 Ta（±5°C），可依環溫差修正到目標 Ta；未對應的通道可直接新增為元件；對應與匯入紀錄存在頁面 `logger_map` / `logger_ambient` / `logger_last` |
| 規格記憶 | 數據頁元件名稱 | 任何報告填過規格的元件名稱 → datalist 提示；輸入同名元件且規格空白時自動帶入；摘要列「⚡ 帶入規格記憶」一次補齊；帶入標註頁元件時自動套用 |
| 摘要列 | 數據頁表格上方 | 共幾顆、Pass / Warning / Fail / 未量測 / 未填規格 / 斷線數，最小 Margin、最高 Tc（點名稱跳到該列），各 Ta 的 CSV 匯入紀錄 |
| 複製為新測試條件 | 頁面清單右鍵（數據頁）| 同元件 / 規格 / Ta，清空實測值、Sensor 讀值、功耗、凍結，立即輸入條件名稱 |
| 貼上模擬結果 | 比對頁 | 貼「名稱 + 溫度」兩欄，依名稱（逐字 token 比對）填 Sim Tc；比對表沒有但數據頁有的元件可自動加入 |
| 結論草稿 / Issues | 結論頁 | 依各數據頁的判定、最小 Margin、功耗、模擬比對統計產生草稿（取代或附加）；Fail / Warning 元件寫入 Issues Found（不重複） |
| 批次圖片頁 | 新增頁面選單 / 圖片頁拖多張 | 依檔名自然排序、每頁 1 / 2 / 4 張、檔名當說明，插在目前頁面之後 |
| 標註批次命名 | 標註頁元件列表 | 每行一個名稱依序套用（空白行保留原名） |
| 頁面徽章 | 左側頁面清單 | 數據頁 ❌n / ⚠n / ✓ / 已量測數、比對頁缺 Sim Tc、結論頁整體判定、圖片 / 標註頁「空」|
| 預設值 | 封面 | 部門、Tested by 記住上次輸入（Tested by 無紀錄時用 Microsoft 帳號名稱） |
| Ctrl+S | 全域 | 立即寫入本機並觸發 SharePoint 同步 |
| 封面同步 / 簽核 | 封面 | Stage 變更同步所有數據頁 `header.stage`；`reviewed_by` / `approved_by` 選填，PDF 只印有填的列 |
| 圖片換位 | 圖片頁 | ◀ ▶ 與相鄰圖片交換（物件整個交換，說明 / 標註 / 編輯跟著走） |
| 量測溫度疊圖 | 標註頁 | `temp_src = { page_id, ta }`；標註名稱與數據頁元件名稱以 token 比對（score ≥ 2）；顯示該 Ta 實測 Tc，依 margin 狀態上色；PDF 標題列附來源與圖例；未手動拉寬的標籤依文字自動寬度 |
| 排序 | 數據頁 | 類別 / 名稱 / 最差 Margin / 最高 Tc；連結用 uid，排序不影響比對頁 / 結論頁 |
| 比較圖 | 比對頁 | Canvas 繪製後以 PNG 嵌入（編輯器與 PDF 相同）；Meas #2357A7 / Sim #EB6834（已驗證色盲可辨）、Derated Spec 虛線、基準線 = 比對 Ta、Dev% 標籤；`show_chart` 可關閉 |
| 比對結論 | 比對頁 | 統計 ✅⚠️❌ 數、平均絕對偏差、平均偏差 > +1°C 判「偏高（偏保守）」/ < −1°C 判「偏低（有低估風險）」、最大偏差元件 |
| 行動產生 | 結論頁 | Fail →「改善 … 散熱並重測」、Warning →「追蹤 … 溫度餘裕」；Owner = 封面 Tested by，期限 +14 天，不重複 |
| 備註 → 圖片頁 | 備註頁 | 記錄的截圖每 4 張一頁，第一行文字當標題、檔名當說明，插在第一個結論頁前 |
| PDF 頁碼 / 標題 / 檔名 | 匯出 | 頁尾中央 `n / N`（依實際匯出頁計算，封面不印）；數據頁標題後印測試條件（頁面標籤）；檔名 `{案名}_{Stage}_{日期}_{版本}_ThermalReport.pdf`；預覽雙擊頁面回到編輯 |
| 自動更新 | 全域 | Pages 部署（`pages.yml`）把建置版本號蓋進 `index.html`（`meta trb-version`）與 `version.json`；工具每 5 分鐘 / 切回視窗時比對，有新版本 → 不可關閉的倒數提示 → 送出編輯中的欄位、寫入本機檔、同步 SharePoint → 以 `?v=<版本>` 重新載入並回到原報告；存檔失敗則改為頂端提示列可重試，不重新載入；同一版本重載兩次仍是舊版則提示手動 Ctrl+Shift+R |

---

## 6. Design System — Liquid Glass UI

### 設計語言定義

本工具採用 **iOS 26 Liquid Glass** 設計語言，以玻璃質感半透明材質為核心視覺語彙。
整體風格定位：**工程師級精準感 × Apple 玻璃質感優雅**，在資訊密度與視覺美感之間取得平衡。

> **核心原則：** Liquid Glass 效果只施加在浮動 UI 骨架（Toolbar、Panel、Modal、Button）。
> **絕不施加在密集數據內容區**（如 Module 4b 數據表），確保可讀性優先。

---

### Liquid Glass 施加規則

| UI 區域 | 效果等級 | 理由 |
|---------|---------|------|
| Toolbar（頂部）| ✅ 完整 Liquid Glass | 浮動元素，最適合 |
| 左側頁面列表 Panel | ✅ 玻璃半透明背景 | 增加層次感 |
| 封面頁欄位 Card | ✅ 玻璃卡片風格 | 視覺焦點頁 |
| Modal / Dialog | ✅ 完整 Liquid Glass + 重度 blur | 彈窗最適合 |
| 主要按鈕（匯出、新增）| ✅ 玻璃按鈕 + 高光邊 | CTA 高辨識度 |
| 頁面列表 Item | ✅ 淡玻璃 hover 效果 | 選中狀態清楚 |
| A4 編輯區（頁面內容）| ⬜ 白色實底 | 模擬真實紙張感 |
| Module 4b 數據表格 | ❌ 不加玻璃 | 密集數字，可讀性優先 |
| 文字輸入欄位 | ⬜ 極淡玻璃底 | 不干擾輸入 |

---

### 色彩系統（Color System）

#### 背景層

```css
/* 整體背景：深色漸層，讓玻璃效果有充足反射層次 */
--bg-base:     #0a0f1e;
--bg-gradient: linear-gradient(135deg, #0a0f1e 0%, #0d1b2e 50%, #0a1628 100%);

/* 背景環境光暈：模擬 iOS 26 動態背景效果 */
--bg-glow-1:   radial-gradient(ellipse at 20% 20%, rgba(56, 189, 248, 0.08) 0%, transparent 60%);
--bg-glow-2:   radial-gradient(ellipse at 80% 80%, rgba(99, 102, 241, 0.06) 0%, transparent 60%);
--bg-glow-3:   radial-gradient(ellipse at 60% 10%, rgba(34, 211, 238, 0.05) 0%, transparent 50%);
```

#### 玻璃材質層（Liquid Glass Material）

```css
/* 主玻璃面板：Toolbar、左側 Panel */
--glass-bg:           rgba(255, 255, 255, 0.08);
--glass-bg-hover:     rgba(255, 255, 255, 0.12);
--glass-bg-active:    rgba(255, 255, 255, 0.16);
--glass-border:       rgba(255, 255, 255, 0.18);
--glass-border-top:   rgba(255, 255, 255, 0.35);   /* 頂部高光邊，模擬玻璃稜邊反光 */
--glass-blur:         20px;
--glass-blur-heavy:   40px;                         /* Modal、Dialog 用 */
--glass-shadow:       0 8px 32px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.2);

/* 次要玻璃：列表 Item、Input 欄位底色 */
--glass-secondary-bg:     rgba(255, 255, 255, 0.05);
--glass-secondary-border: rgba(255, 255, 255, 0.10);
```

#### 語義色彩

```css
/* 主要動作色（藍色系，科技感） */
--color-primary:        rgba(56, 189, 248, 1.0);    /* #38bdf8 sky-400 */
--color-primary-glass:  rgba(56, 189, 248, 0.15);   /* 玻璃按鈕底色 */
--color-primary-glow:   rgba(56, 189, 248, 0.30);   /* 按鈕 glow shadow */

/* 狀態色 */
--color-success:        rgba(34, 197, 94,  1.0);    /* #22c55e green-500 */
--color-success-bg:     rgba(34, 197, 94,  0.12);
--color-warning:        rgba(250, 204, 21, 1.0);    /* #facc15 yellow-400 */
--color-warning-bg:     rgba(250, 204, 21, 0.12);
--color-danger:         rgba(239, 68,  68, 1.0);    /* #ef4444 red-500 */
--color-danger-bg:      rgba(239, 68,  68, 0.12);

/* 文字色 */
--text-primary:         rgba(255, 255, 255, 0.95);
--text-secondary:       rgba(255, 255, 255, 0.60);
--text-placeholder:     rgba(255, 255, 255, 0.30);
--text-on-white:        rgba(15,  23,  42, 0.90);   /* A4 編輯區白底上的文字 */
```

---

### 核心元件 CSS 規格

#### Toolbar（頂部）

```css
.toolbar {
  background: rgba(10, 15, 30, 0.75);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border-bottom: 1px solid var(--glass-border);
  box-shadow: 0 1px 0 var(--glass-border-top), var(--glass-shadow);
}
```

#### 左側 Panel

```css
.sidebar {
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border-right: 1px solid var(--glass-border);
}

/* 頁面列表 Item — 選中狀態 */
.page-item.active {
  background: var(--glass-bg-active);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  border-radius: 12px;
}
```

#### 玻璃卡片（Card）

```css
.glass-card {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);    /* 頂部高光邊 */
  border-radius: 20px;
  box-shadow: var(--glass-shadow),
              inset 0 1px 0 rgba(255, 255, 255, 0.15);  /* 內側頂部光澤 */
}
```

#### 主要按鈕（Liquid Glass Button）

```css
.btn-primary {
  background: var(--color-primary-glass);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(56, 189, 248, 0.40);
  border-top-color: rgba(56, 189, 248, 0.70);   /* 頂部高光 */
  border-radius: 12px;
  color: var(--color-primary);
  box-shadow: 0 0 16px var(--color-primary-glow),
              inset 0 1px 0 rgba(255, 255, 255, 0.20);
  transition: all 0.2s ease;
}

.btn-primary:hover {
  background: rgba(56, 189, 248, 0.22);
  box-shadow: 0 0 24px var(--color-primary-glow),
              inset 0 1px 0 rgba(255, 255, 255, 0.25);
  transform: translateY(-1px);
}
```

#### Modal / Dialog

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.50);
  backdrop-filter: blur(4px);
}

.modal-panel {
  background: rgba(13, 27, 46, 0.85);
  backdrop-filter: blur(var(--glass-blur-heavy));
  -webkit-backdrop-filter: blur(var(--glass-blur-heavy));
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  border-radius: 24px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.50),
              inset 0 1px 0 rgba(255, 255, 255, 0.15);
}
```

#### A4 頁面編輯區（白底，模擬紙張）

```css
.page-canvas {
  background: #ffffff;
  border-radius: 4px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.40),
              0 1px 4px  rgba(0, 0, 0, 0.30);
  color: var(--text-on-white);
  /* 不加 backdrop-filter，確保顏色精準用於 PDF 匯出 */
}
```

---

### 字型系統（Typography）

```css
/* 字型堆疊：優先使用系統字體，確保跨平台一致 */
--font-ui:   -apple-system, BlinkMacSystemFont, "SF Pro Display",
              "Helvetica Neue", "PingFang TC", sans-serif;
--font-data: "SF Mono", "JetBrains Mono", "Courier New", monospace;  /* 數字欄位 */

/* 字型大小層次（最多 3 層） */
--text-xs:   11px;   /* 狀態列、標籤 Tag */
--text-sm:   13px;   /* 數據表格、說明文字 */
--text-base: 15px;   /* 主要 UI 文字 */
--text-lg:   18px;   /* 頁面標題、Section Header */
--text-xl:   24px;   /* 報告書案名（封面頁）*/

/* 字重 */
--font-normal:   400;
--font-medium:   500;
--font-semibold: 600;
```

---

### 間距系統（Spacing）

採用 **4px 基準單位**，所有間距為 4 的倍數：

```css
--space-1:  4px;
--space-2:  8px;
--space-3:  12px;
--space-4:  16px;
--space-5:  20px;
--space-6:  24px;
--space-8:  32px;
--space-10: 40px;
--space-12: 48px;
```

---

### 圓角系統（Border Radius）

```css
--radius-sm:   8px;    /* 輸入欄位、小 Badge */
--radius-md:   12px;   /* 按鈕、列表 Item */
--radius-lg:   16px;   /* 卡片內容區塊 */
--radius-xl:   20px;   /* 主要 Glass Card */
--radius-2xl:  24px;   /* Modal Panel */
--radius-full: 9999px; /* Pill Tag、狀態指示點 */
```

---

### 動畫規格（Motion）

```css
/* 基礎過渡：所有互動元素預設 */
--transition-fast:   0.15s ease;   /* hover 狀態切換 */
--transition-base:   0.20s ease;   /* 按鈕、列表 Item */
--transition-slow:   0.30s ease;   /* Panel 展開、Modal 進場 */
--transition-spring: 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);  /* 彈性動畫（新增頁面）*/

/* 進場動畫：頁面列表 Item 出現 */
@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Modal 進場 */
@keyframes modalIn {
  from { opacity: 0; transform: scale(0.95) translateY(8px); }
  to   { opacity: 1; transform: scale(1)    translateY(0); }
}
```

---

### 狀態色彩對照（Thermal Data 專用）

配合 Module 4b Margin 警示與 Module 5 Dev 警示，數據表內部沿用以下規則：

```css
/* Margin / Pass-Fail 狀態（數據表白底區域使用，非玻璃色系） */
--data-pass-bg:    rgba(220, 252, 231, 1);   /* #dcfce7 — 綠底 */
--data-pass-text:  rgba(21,  128, 61,  1);   /* #15803d — 深綠字 */
--data-warn-bg:    rgba(254, 249, 195, 1);   /* #fef9c3 — 黃底 */
--data-warn-text:  rgba(161, 98,  7,   1);   /* #a16207 — 深黃字 */
--data-fail-bg:    rgba(254, 226, 226, 1);   /* #fee2e2 — 紅底 */
--data-fail-text:  rgba(185, 28,  28,  1);   /* #b91c1c — 深紅字 */
```

---

### PDF 匯出相容性注意事項

> html2canvas 截圖時，`backdrop-filter` 在部分瀏覽器截圖可能失效。

**解決策略：**
- A4 頁面編輯區（`.page-canvas`）**不使用** backdrop-filter，改用實色背景確保截圖準確。
- 匯出前自動切換至「匯出模式」，暫時隱藏 UI 裝飾層（Toolbar、Sidebar），只截 A4 內容區。
- html2canvas 參數：`scale: 2, useCORS: true, allowTaint: false`。

---

## 7. 開發階段規劃

### Phase 1：MVP（可交付完整 PDF 報告）

#### 基礎架構
- [ ] Firebase 初始化（Firestore + Storage + offline persistence）
- [ ] 報告書首頁（列表 + 新增 + 刪除）
- [ ] 基礎框架：左側頁面列表 + 右側編輯區 + Toolbar
- [ ] 頁面拖曳排序（Firestore order 欄同步）
- [ ] 自動儲存機制（debounce 1000ms）
- [ ] 狀態列（已儲存 / 儲存中 / 離線模式）

#### 頁面模組
- [ ] Module 1：封面頁
- [ ] Module 2：圖片頁（2×2 四象限動態排版 + Ctrl+V / 拖拉 / 選檔）
- [ ] Module 6：結論頁（文字版，不含自動彙總）

#### 匯出
- [ ] 預覽模式（全螢幕 Slide Show）
- [ ] **匯出 PDF**（html2canvas + jsPDF）

---

### Phase 2：核心功能完整版

- [ ] Module 3：量測點標註頁（SVG 互動標註系統）
- [ ] Module 4：實驗數據頁
  - [ ] 4a 實驗條件 Header
  - [ ] 4b 量測數據表（動態 Ta 欄展開）
  - [ ] 4c Embedded Sensor 子區塊（可收合）
- [ ] Module 5：Sim vs Meas 比對頁
  - [ ] 從 Module 4b 選取元件 Checklist
  - [ ] Dev 自動計算與顏色警示
- [ ] Module 6 結論頁自動彙總（從 Module 4b 帶入 Pass/Fail 總表）
- [ ] **匯出 PPTX**（PptxGenJS）
- [ ] 頁面複製功能

---

### Phase 3：進階整合（未來規劃）

- [ ] Module 4b Spec Tc 從 Firebase `rf_library` / `digital_library` 自動帶入
- [ ] Module 5 Dev 摘要自動帶入 Module 6 結論頁
- [ ] 多版本（EVT vs DVT）數據比較 Bar Chart
- [ ] 報告書唯讀分享連結

---

## 8. 技術依賴清單

| 套件 | 版本 | 用途 | CDN |
|------|------|------|-----|
| Firebase SDK | 10.x | Firestore + Storage + offline | jsDelivr |
| html2canvas | 1.4.x | PDF 截圖 | jsDelivr |
| jsPDF | 2.x | PDF 生成 | jsDelivr |
| PptxGenJS | 3.x | PPTX 生成（Phase 2）| jsDelivr |
| SortableJS | 1.15.x | 頁面列表拖曳排序 | jsDelivr |

> **全部透過 CDN 引入，無需 npm / build 工具，直接在單一 `index.html` 運行。**

---

## 9. 待處理事項（Post-Phase 1）

| # | 問題 | 影響範圍 | 優先度 |
|---|------|---------|--------|
| 1 | Firebase 專案確認：沿用現有或新建？ | Phase 1 Firebase 初始化 | 🔴 高 |
| 2 | Module 4b 數據表：多 Ta 條件並排的橫向空間在 A4 直向是否足夠？（4 個 Ta × 2 欄 = 8 欄動態欄）| Phase 2 數據頁 | 🟡 中 |
| 3 | 圖片儲存門檻：500KB 切換點是否合適？（IR 圖片通常 1-3MB）| Phase 1 Firebase | 🟡 中 |

---

*SPEC v1.2 — 最後更新：2026-03-20*
*下一步：Claude Code Phase 1 實作*
