# Delta Blue Futuristic Design Spec — 通用型熱流實測報告工具

> 本文件為整份 App 的視覺設計規範。所有頁面（Cover / Image / TC Annotation / Test Data / Sim vs Meas / Conclusion）都必須遵循同一套設計語言。
> **重要：所有範例中的文字（Project name、Engineer name 等）都是 placeholder，不可寫死任何特定報告內容。**

---

## 1. 設計方向（Design Direction）

**風格定位：精密儀器 × 工程藍圖（Precision Instrument × Engineering Blueprint）**

整體視覺要讓使用者感覺到：
- 這是一份來自專業研發團隊的技術報告，不是普通文件
- 打開報告的第三者，會先被外觀質感吸引，再進入內容
- 工具本身操作時也有「高端實驗設備操作面板」的感覺

**核心視覺語言（5 個簽名元素）：**

| 元素 | 說明 | 使用位置 |
|------|------|----------|
| **Angle-cut (斜切)** | 按鈕與 tag 使用 `clip-path: polygon(6px 0, 100% 0, calc(100%-6px) 100%, 0 100%)` 做 45° 斜切，取代圓角 | 所有按鈕、badge、pill tag |
| **Blueprint grid (藍圖格線)** | 淡藍色工程格線背景 | 編輯區主畫布、封面/圖片頁的圖片預留區 |
| **Corner brackets (角框定位標記)** | 四角 L 型角框（border-top + border-left 組合） | 每張報告頁面（匯出 PDF 的頁面）的四角 |
| **Crosshair (十字準心)** | 圖片區中心的十字游標 | 圖片預留區、TC 標註頁的底圖 |
| **Progression bar (品牌漸進色帶)** | 頂部 + 底部色帶 | 每張報告頁面的最頂部和最底部 |

---

## 2. 色票系統（Color Tokens）

### 2a. 台達藍主色階（Delta Blue Ramp）

```css
:root {
  --d-900: #021B3A;   /* 最深 — 大面積深色背景 */
  --d-800: #042952;   /* Toolbar 底色 / 深色區塊 */
  --d-700: #0B3D7A;   /* Toolbar 底色（搭配漸層）/ sidebar 深色 */
  --d-600: #1A4E96;   /* 次要深色 */
  --d-500: #2357A7;   /* ★ 台達藍核心色 — 主色調 */
  --d-400: #3A7AD4;   /* Primary 按鈕底色 / 互動 hover */
  --d-300: #5BA3E6;   /* Accent 強調色 / 品牌元素 */
  --d-200: #8DC4F0;   /* 淺藍 — 線條、邊框、icon */
  --d-100: #C2DFF8;   /* 更淺 — 分隔線、次要邊框 */
  --d-50:  #E8F0FA;   /* 最淺 — 選中底色、hover 底色 */
}
```

### 2b. 語義色（Semantic Colors）

```css
:root {
  --color-pass:    #27AE60;  /* 合格 / Pass ✅ */
  --color-fail:    #E74C3C;  /* 超溫 / Fail ❌ */
  --color-warn:    #F39C12;  /* 接近上限 / Warning ⚠️ */
  --color-neutral: #8E8E93;  /* 中性灰 / 不適用 */
  --color-bg:      #F7F9FC;  /* 頁面底色 */
  --color-bg2:     #EDF2F8;  /* 次要背景 */
}
```

### 2c. Progression Bar 漸層

所有報告頁面的頂部（6px 高）和底部（3-4px 高）使用此漸層：

```css
background: linear-gradient(
  90deg,
  #0B3D7A 0%,      /* 深藍 */
  #2357A7 25%,     /* 台達藍 */
  #3A7AD4 45%,     /* 亮藍 */
  #5BA3E6 60%,     /* 智能藍 */
  #6EC5A0 80%,     /* 過渡綠 */
  #4CAF79 100%     /* 自然綠 */
);
```

---

## 3. 字型系統（Typography）

### 使用字型

| 用途 | 字型 | 載入方式 |
|------|------|----------|
| **標題 / 品牌文字** | `Space Grotesk` (500, 600, 700) | Google Fonts CDN |
| **內文 / UI 文字** | `DM Sans` (400, 500, 700) | Google Fonts CDN |
| **技術標籤 / 代碼** | `JetBrains Mono` (400, 500) | Google Fonts CDN |

```html
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### 字型使用規則

| 場景 | 字型 | 大小 | 重量 | 字距 |
|------|------|------|------|------|
| 報告封面專案名 | Space Grotesk | 20-26px | 700 | -0.01em |
| 報告頁面標題 | Space Grotesk | 16-18px | 600 | 0.02em |
| Toolbar 品牌名 "DELTA" | Space Grotesk | 13px | 700 | 0.12em |
| 頁面類型標籤 "THERMAL TEST REPORT" | JetBrains Mono | 8-10px | 400 | 0.18em |
| 側邊欄 section header "PAGES" | JetBrains Mono | 9px | 400 | 0.1em |
| 側邊欄頁面編號 "01" "02" | JetBrains Mono | 9px | 400 | — |
| 側邊欄頁面名稱 | DM Sans | 11px | 400 (active: 500) | — |
| Canvas 標籤 "A4 LANDSCAPE" | JetBrains Mono | 9px | 400 | 0.06em |
| 按鈕文字 | Space Grotesk | 11px | 500 | 0.04em |
| 表格內文 / 一般內文 | DM Sans | 12-13px | 400 | — |
| 封面 metadata (Stage / Engineer / Date) | DM Sans | 10-12px | 400 | — |
| 頁尾 "CONFIDENTIAL" | JetBrains Mono | 8-9px | 400 | — |

---

## 4. 元件規範（Component Specs）

### 4a. 按鈕（Buttons）

所有按鈕使用斜切造型，**絕對不用 border-radius 圓角**：

```css
/* 基礎按鈕 */
.btn {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  padding: 6px 14px;
  border: none;
  cursor: pointer;
  clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%);
  transition: all 0.15s ease;
}
.btn:active {
  transform: scale(0.97);
}

/* Ghost — 用在深色背景上的透明按鈕 */
.btn-ghost {
  background: rgba(91, 163, 230, 0.12);
  color: #ffffff;
  border: 1px solid rgba(91, 163, 230, 0.3);
}
.btn-ghost:hover {
  background: rgba(91, 163, 230, 0.22);
}

/* Primary — 主要操作 */
.btn-primary {
  background: var(--d-400);  /* #3A7AD4 */
  color: #ffffff;
}
.btn-primary:hover {
  background: var(--d-300);  /* #5BA3E6 */
}

/* Accent — 最重要操作（匯出等） */
.btn-accent {
  background: var(--d-300);  /* #5BA3E6 */
  color: #ffffff;
  font-weight: 600;
}
.btn-accent:hover {
  background: var(--d-200);  /* #8DC4F0 */
  color: var(--d-800);
}
```

> ⚠️ **重要：所有在深色背景（Toolbar / Sidebar）上的按鈕，文字一律為 `#ffffff` 白色。**
> 不可使用深藍色文字在深藍底色上，會看不清楚。

### 4b. Toolbar

```css
.toolbar {
  background: var(--d-900);  /* #021B3A */
  background-image: linear-gradient(180deg, rgba(11,61,122,0.4) 0%, transparent 100%);
  padding: 8px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(91, 163, 230, 0.15);
}
```

Logo 區：
- Delta 三角形 SVG logo（#5BA3E6 描邊）
- "DELTA" 文字：Space Grotesk 13px 700, #ffffff, letter-spacing 0.12em
- 副標 "THERMAL TEST REPORT"：JetBrains Mono 9px, var(--d-300)
- Logo 與 title 之間用 1px 分隔線: `width:1px; height:24px; background:rgba(91,163,230,0.2)`

### 4c. 側邊欄（Sidebar）

```css
.sidebar {
  width: 152px;
  border-right: 1px solid rgba(91, 163, 230, 0.1);
  padding: 10px 0;
  background: rgba(4, 41, 82, 0.3);  /* 半透明深藍 */
}

.page-item {
  padding: 7px 12px;
  font-family: 'DM Sans', sans-serif;
  font-size: 11px;
  color: var(--d-200);  /* #8DC4F0 */
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: all 0.15s;
}

.page-item:hover {
  background: rgba(91, 163, 230, 0.06);
}

.page-item.active {
  background: rgba(35, 87, 167, 0.15);
  color: #ffffff;
  border-left-color: var(--d-300);  /* #5BA3E6 亮藍指示條 */
  font-weight: 500;
}

/* 頁面編號 */
.page-idx {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  color: var(--d-400);  /* active 時改為 var(--d-300) */
  width: 16px;
  text-align: right;
  flex-shrink: 0;
}
```

### 4d. 主編輯區（Main Canvas Area）

```css
.main-area {
  flex: 1;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* Blueprint 格線背景 */
  background-image:
    repeating-linear-gradient(0deg,
      rgba(35,87,167,0.08) 0, rgba(35,87,167,0.08) 1px,
      transparent 1px, transparent 40px),
    repeating-linear-gradient(90deg,
      rgba(35,87,167,0.08) 0, rgba(35,87,167,0.08) 1px,
      transparent 1px, transparent 40px);
  background-size: 40px 40px;
  position: relative;
}

/* 中心輔助線 */
.main-area::before {
  content: '';
  position: absolute;
  top: 0; left: 50%;
  width: 1px; height: 100%;
  background: rgba(91, 163, 230, 0.08);
}

/* A4 Canvas 標籤 */
.canvas-tag {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  color: var(--d-400);
  letter-spacing: 0.06em;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.canvas-tag::before,
.canvas-tag::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(91, 163, 230, 0.15);
}
```

---

## 5. 報告頁面共用結構（Exported Page Structure）

**每一頁報告（不論類型）都必須包含以下結構：**

```
┌──────────────────────────────────────────────┐
│ ▓▓▓▓▓▓ Progression Bar (6px) ▓▓▓▓▓▓▓▓▓▓▓▓▓ │  ← 頂部漸進色帶
│ ┌──┐                                  ┌──┐  │  ← Corner brackets
│ │  │                                  │  │  │
│                                              │
│            [頁面主要內容區]                    │
│                                              │
│ │  │                                  │  │  │
│ └──┘                                  └──┘  │  ← Corner brackets
│ [Department]              [CONFIDENTIAL]     │  ← 頁尾
│ ▓▓▓▓▓▓ Progression Bar (3px) ▓▓▓▓▓▓▓▓▓▓▓▓▓ │  ← 底部漸進色帶
└──────────────────────────────────────────────┘
```

### Corner Brackets CSS

```css
.corner-tl, .corner-tr, .corner-bl, .corner-br {
  position: absolute;
  width: 32px;
  height: 32px;
}
.corner-tl { top: 12px; left: 12px;   border-top: 1.5px solid var(--d-200); border-left: 1.5px solid var(--d-200); }
.corner-tr { top: 12px; right: 12px;  border-top: 1.5px solid var(--d-200); border-right: 1.5px solid var(--d-200); }
.corner-bl { bottom: 12px; left: 12px;  border-bottom: 1.5px solid var(--d-200); border-left: 1.5px solid var(--d-200); }
.corner-br { bottom: 12px; right: 12px; border-bottom: 1.5px solid var(--d-200); border-right: 1.5px solid var(--d-200); }
```

### Progression Bar CSS

```css
/* 頂部 */
.page::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 6px;
  background: linear-gradient(90deg, #0B3D7A, #2357A7, #3A7AD4, #5BA3E6, #6EC5A0, #4CAF79);
}

/* 底部 */
.page::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #0B3D7A, #2357A7, #3A7AD4, #5BA3E6, #6EC5A0, #4CAF79);
}
```

### Crosshair（圖片預留區用）

```css
.crosshair {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
}
.crosshair::before {
  content: '';
  position: absolute;
  width: 24px; height: 1px;
  top: 0; left: -12px;
  background: var(--d-200);
}
.crosshair::after {
  content: '';
  position: absolute;
  width: 1px; height: 24px;
  top: -12px; left: 0;
  background: var(--d-200);
}
```

### 圖片預留區 Blueprint 格線

```css
.img-area {
  background: var(--color-bg);  /* #F7F9FC */
  border: 1px solid var(--d-100);
  position: relative;
  overflow: hidden;
}
.img-area::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    repeating-linear-gradient(0deg,
      rgba(35,87,167,0.03) 0, rgba(35,87,167,0.03) 1px,
      transparent 1px, transparent 20px),
    repeating-linear-gradient(90deg,
      rgba(35,87,167,0.03) 0, rgba(35,87,167,0.03) 1px,
      transparent 1px, transparent 20px);
}
```

---

## 6. 各頁面設計重點提示

### Cover Page（封面頁）— A4 橫向
- 頂部：Progression Bar
- 左上角：頁面類型標籤 `THERMAL TEST REPORT`（JetBrains Mono 8px, 0.18em 字距）
- 專案名：Space Grotesk 20px 700, 色 var(--d-700)
- 分隔線：寬 48px, 高 2px, 色 var(--d-400)
- Metadata 列：Stage / Engineer / Date 水平排列
- 中央：圖片預留區（含 blueprint grid + crosshair）
- 底部：Footer（部門 / CONFIDENTIAL）+ Progression Bar

### Image Page（圖片頁）— A4 橫向
- 共用結構同上（Progression Bar + Corner Brackets）
- 頂部標題：Space Grotesk 16px 600, 可編輯
- 四張圖片 2×2 grid，每張下方有描述文字欄
- 圖片未上傳時顯示 blueprint grid + crosshair 佔位

### TC Annotation Page（標註頁）— A4 橫向
- 共用結構同上
- 頂部標題可編輯
- 中央為一張大圖 + SVG 標註層
- 標註點使用 var(--d-300) 藍色圓點 + 引線
- 文字標籤使用 JetBrains Mono 字型

### Test Data Page（數據頁）— A4 直向
- 共用結構同上
- 頂部實驗條件 Header 區（灰底 var(--color-bg2)）
- 數據表格：表頭底色 var(--d-700)，文字白色
- 超溫行底色 var(--color-fail) 淡色版 rgba(231,76,60,0.08)
- 合格行使用 var(--color-pass) 淡色版

### Sim vs Meas Page（比對頁）— A4 橫向
- 共用結構同上
- 左半：模擬結果圖片（含 blueprint grid 佔位）
- 右半：量測結果圖片
- 下方：deviation 對照表

### Conclusion Page（結論頁）— A4 直向
- 共用結構同上
- 結論摘要：富文本區
- 問題列表 / 後續行動：條列項目，前方指示器使用 var(--d-400) 色

---

## 7. 重點禁忌（Do Not）

1. **不可使用 border-radius 圓角按鈕** — 全部用 clip-path 斜切
2. **不可在深色背景上使用深色文字** — 深色背景上所有文字為白色或淺藍色
3. **不可寫死任何特定報告內容** — 所有文字欄位都是 placeholder（用 `[Project name]` / `[Engineer]` 格式）
4. **不可省略 Progression Bar 和 Corner Brackets** — 這是每一頁報告的品牌 DNA
5. **不可使用 Inter / Roboto / Arial 字型** — 只用 Space Grotesk + DM Sans + JetBrains Mono
6. **不可使用純黑 #000000 或純白 #FFFFFF** — 最深色用 var(--d-900)，最淺色用 var(--d-50)

---

## 8. Delta Logo（使用透明背景 PNG）

> **重要**：
> 1. 不要手繪 SVG 仿製 Logo — 官方 Logo 的橢圓弧度和衛星球比例無法精確還原。
> 2. 不要對原始 PNG 使用 `filter: brightness(0) invert(1)` — 白色背景會一起被反轉成黑色。
> 3. 正確做法：使用**已去除白色背景的透明 PNG**，深色/淺色背景都直接使用，不需任何 filter。

### 8a. 圖檔位置

```
assets/delta-logo-transparent.png   ← 透明背景版（唯一需要的版本）
```

此檔案已用 Python Pillow 將官方 Logo 的白色背景移除（alpha=0），
保留藍色三角形（#00AEEF）和白色軌道 + 衛星球。

### 8b. Toolbar 使用（深色背景）

```html
<img
  src="assets/delta-logo-transparent.png"
  alt="Delta"
  style="height: 28px; width: auto; object-fit: contain;"
>
```

**不需要任何 CSS filter！** 透明背景上的藍色三角形和白色軌道，
在深色 Toolbar（var(--d-900) #021B3A）上天然清晰可見。

### 8c. 報告頁面使用（淺色背景）

```html
<img
  src="assets/delta-logo-transparent.png"
  alt="Delta"
  style="height: 40px; width: auto; object-fit: contain;"
>
```

同樣不需要 filter，透明背景讓 Logo 自然融入任何底色。

### 8d. Logo 旁的文字

Toolbar 上 Logo 圖片**只包含三角形 icon**（不含文字），
"DELTA" 和副標文字用 HTML 獨立呈現，避免重複。

```html
<img src="assets/delta-logo-transparent.png" alt="Delta" style="height:28px;">
<div class="toolbar-brand">
  <span class="toolbar-brand-name">DELTA</span>
  <span class="toolbar-brand-sub">THERMAL TEST REPORT</span>
</div>
```

> ⚠️ **注意**：如果使用的官方 Logo 圖片本身包含 "DELTA" 文字，
> 則不要再另外寫 "DELTA" 文字，否則會出現兩次。
> 請確認所用的 PNG 是純 icon 版本還是含文字版本。

> 正式報告匯出的 PDF/PPTX 中，Logo 同樣使用此透明 PNG 嵌入。

---

## 附錄 A：Logo 檔案位置

Logo 已放在專案 `assets/` 目錄中：

```
assets/delta-logo-transparent.png   ← 原始尺寸 128×106px（報告頁面用）
assets/delta-logo-toolbar.png       ← 縮小版 67×56px（Toolbar 用，顯示為 28px 高）
```

在程式中讀取這些 PNG 檔案，轉為 base64 嵌入 HTML 即可：

```javascript
// 讀取 assets/ 下的 PNG 檔，轉成 base64 data URL 嵌入 <img src="...">
// 不需要任何 CSS filter，透明背景在深色/淺色底上都直接可用
```

## 附錄 B：給 Claude Code 的完整指令範本

複製以下指令，貼到 Claude Code 中執行：

---

**指令開始：**

請閱讀 DELTA_BLUE_DESIGN_SPEC.md 設計規範文件，然後按照以下要求重新設計整個 App 的 UI：

1. **色票系統**：使用 Section 2 定義的 CSS 變數（`--d-50` 到 `--d-900` 台達藍色階 + 語義色）
2. **字型系統**：載入 Space Grotesk + DM Sans + JetBrains Mono（Section 3）
3. **按鈕**：全部改為斜切造型 `clip-path`，不可使用 `border-radius` 圓角（Section 4a）
4. **Toolbar**：深藍背景 + 透明 Logo PNG + 白色文字按鈕（Section 4b），按鈕文字全部白色
5. **側邊欄**：半透明深藍底 + 亮藍 active 指示條 + JetBrains Mono 頁碼（Section 4c）
6. **編輯區**：Blueprint 格線背景 + 中心輔助線（Section 4d）
7. **每頁報告**：必須包含頂部 Progression Bar (6px) + 底部 Progression Bar (3px) + 四角 Corner Brackets（Section 5）
8. **圖片預留區**：Blueprint 小格線 + 十字準心 Crosshair（Section 5）
9. **Logo**：使用附錄 A 的 base64 常數嵌入，不可手繪 SVG，不可使用 CSS filter
10. **禁忌**：不可用圓角按鈕、不可在深色背景用深色文字、不可寫死特定報告內容、不可用 Inter/Roboto 字型

所有頁面模組（Cover / Image / TC Annotation / Test Data / Sim vs Meas / Conclusion）都必須遵循同一套設計語言。

**指令結束。**

