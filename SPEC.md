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
| **部署方式** | GitHub Pages（單一 `index.html`，無後端）|
| **技術限制** | 無 Python、無後端、純瀏覽器執行，公司防火牆限制 |
| **資料持久化** | Firebase Firestore + Firebase Storage |
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
Module 4b（Ta = 55°C 實測 Tc）
        ↓ 自動帶入（元件名 + 實測 Tc @ 55°C）
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
Step 5  確認後自動帶入：元件名稱 + Tc Spec Derated + Meas Tc @ 55°C
Step 6  Sim Tc 欄留空，等待手動填入
```

#### 欄位規格

| 欄 | 欄位名稱 | 來源 | 說明 |
|---|---------|------|------|
| A | 類別 | Module 4b 自動帶入 | 唯讀 |
| B | 元件名稱 | Module 4b 自動帶入 | 唯讀 |
| C | Tc Spec Derated (°C) | Module 4b 自動帶入 | 唯讀，參考用 |
| D | **Sim Tc @ 55°C (°C)** | **手動輸入** | 從 FloTHERM Monitor Point 抄入 |
| E | **Meas Tc @ 55°C (°C)** | Module 4b 自動帶入 | 唯讀 |
| F | **Dev (°C)** | 自動計算 | `= D - E`，正值代表 Sim 高估 |
| G | **Dev (%)** | 自動計算 | `= (D - E) / E × 100` |
| H | 判斷 | 自動 | 依 Dev% 顏色警示（見下方）|
| I | 備註 | 手動輸入 | 如：模擬假設差異、量測點位置說明 |

#### Dev 顏色警示規則

| \|Dev %\| | 判斷 | 顏色 |
|----------|------|------|
| ≤ 10% | ✅ Acceptable | 綠色 |
| 10% ~ 20% | ⚠️ Review | 黃色 |
| > 20% | ❌ Check Model | 紅色 |

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
| 合規性總表 | 自動彙總（Phase 2）| 從 Module 4b 帶入：元件 / 最高量測 Tc / Derated Spec / 判斷 |
| 發現問題（Issues Found）| 條列輸入 | 每條一行，可新增 / 刪除 |
| 後續行動（Next Action）| 條列輸入 | 每條附 Owner 欄 + Due Date 欄 |

---

## 4. Firebase 資料架構

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

### 報告書首頁（報告列表）

| 功能 | 說明 |
|------|------|
| 顯示內容 | 案名、Stage、日期、最後編輯時間 |
| 排序 | 依 `updated_at` 降序（最新在上）|
| 操作 | 開啟 / 複製 / 刪除 |
| 新增 | 首頁「+ 新增報告」按鈕 → 進入封面頁設定 |

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