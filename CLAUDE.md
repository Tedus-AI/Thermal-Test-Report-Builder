# Thermal Test Report Builder — Claude Code 啟動說明

## 任務概述
Thermal Test Report Builder

## 開始前請依序閱讀
1. SPEC.md — 完整規格與功能清單
2. 以下 Skill 檔案：
   - .claude/skills/pdf.md：Use this skill whenever the user wants to do anything with PDF files. This includes reading or extracting text/tables from PDFs, combining or merging multiple PDFs into one, splitting PDFs apart, rotating pages, adding watermarks, creating new PDFs, filling PDF forms, encrypting/decrypting PDFs, extracting images, and OCR on scanned PDFs to make them searchable. If the user mentions a .pdf file or asks to produce one, use this skill.
   - .claude/skills/pptx.md：Use this skill any time a .pptx file is involved in any way — as input, output, or both. This includes: creating slide decks, pitch decks, or presentations; reading, parsing, or extracting text from any .pptx file (even if the extracted content will be used elsewhere, like in an email or summary); editing, modifying, or updating existing presentations; combining or splitting slide files; working with templates, layouts, speaker notes, or comments. Trigger whenever the user mentions \"deck,\" \"slides,\" \"presentation,\" or references a .pptx filename, regardless of what they plan to do with the content afterward. If a .pptx file needs to be opened, created, or touched, use this skill.
   - .claude/skills/uiux-designer-expert.md：>
   - .claude/skills/thermal-engineering-expert.md：>
   - .claude/skills/xlsx.md：Use this skill any time a spreadsheet file is the primary input or output. This means any task where the user wants to: open, read, edit, or fix an existing .xlsx, .xlsm, .csv, or .tsv file (e.g., adding columns, computing formulas, formatting, charting, cleaning messy data); create a new spreadsheet from scratch or from other data sources; or convert between tabular file formats. Trigger especially when the user references a spreadsheet file by name or path — even casually (like \"the xlsx in my downloads\") — and wants something done to it or produced from it. Also trigger for cleaning or restructuring messy tabular data files (malformed rows, misplaced headers, junk data) into proper spreadsheets. The deliverable must be a spreadsheet file. Do NOT trigger when the primary deliverable is a Word document, HTML report, standalone Python script, database pipeline, or Google Sheets API integration, even if tabular data is involved.
   - .claude/skills/impeccable-frontend-design.md：Create distinctive, production-grade frontend interfaces with exceptional design quality — actively avoiding generic AI aesthetics. Use this skill whenever the user asks to build web components, pages, artifacts, dashboards, forms, tools, posters, or any UI. Also use when the user asks to audit, polish, simplify, critique, animate, or improve an existing interface. Generates creative, polished code that avoids AI slop: no Inter font, no purple gradients, no card-in-card nesting, no glassmorphism by default. Based on the Impeccable design system (github.com/pbakaus/impeccable).
   - .claude/skills/agentic-workflow.md：>
   - .claude/skills/canvas-design.md：Create beautiful visual art in .png and .pdf documents using design philosophy. You should use this skill when the user asks to create a poster, piece of art, design, or other static piece. Create original visual designs, never copying existing artists' work to avoid copyright violations.
   - .claude/skills/web-artifacts-builder.md：Suite of tools for creating elaborate, multi-component claude.ai HTML artifacts using modern frontend web technologies (React, Tailwind CSS, shadcn/ui). Use for complex artifacts requiring state management, routing, or shadcn/ui components - not for simple single-file HTML/JSX artifacts.

## 第一步
根據 SPEC.md 中的功能清單，從第一個 High 優先級的功能開始實作。

## 技術架構
- 前端框架：（未選擇）
- 資料庫：（未選擇）
- 介面需求：（未選擇）
- 部署平台：（未選擇）

## 注意事項
（未填寫）


## 使用者體驗（UX）慣例 ⚠️ — 動任何 UI 前必讀

開發或修改任何 UI 前，先讀 `docs/UX-KNOWLEDGE-BASE.md`。那是從五個 repo 約 300 個
commit 的修 bug 歷史提煉出的慣例；**使用者不會每次重新描述這些需求，預設你已遵守。**

最核心的十二條（完整版與踩坑出處見文件）：

1. **輸入中絕不整區重繪**（游標會跳開）；重繪後還原捲動位置；表格支援 Excel 貼上。
2. **自動帶入欄位一律「鎖定＋✂ 解鎖逃生口」**；純參照值顯示白底黑字純文字，
   不用反灰 disabled input。
3. **能自動判定就不讓使用者手選**（如 Verdict 由 Margin 推導）；自動帶入要有
   fallback，不能只認 happy path。
4. **單一事實來源**：改名連動更新所有參照；鏡像欄位做成唯讀；重複輸入用
   「一鍵帶入」消滅；建議值 click-to-apply 不直接改使用者輸入。
5. **螢幕／預覽／PDF 三方永遠同步**：改編輯器就同一 commit 同步 PDF builder；
   色值字級抽共用常數；PDF 分頁門檻用實測座標校準（CJK 字型量測會低估）。
6. **小螢幕（17 吋筆電）策略是加寬整頁**回收留白，不是硬塞 A4；header 元素
   流動排列防重疊；浮動框 clamp 在 viewport 內。
7. **紅色保留給 Fail/錯誤**；分類色彼此區隔；圖表疊加元素要與「所有可能的
   底色」都有對比；深淺主題都要檢查。
8. **標註/畫布座標一律存相對座標（0~1）**防重開飄移；跨螢幕等比縮放；
   編輯模式與標註模式互斥；存檔時對帳清理孤兒附件。
9. **鎖定/唯讀狀態要全面**：所有寫入入口反灰＋給唯讀檢視；切換前攔截未儲存
   變更（儲存/放棄/取消）；顯示誰持有鎖。
10. **按任一儲存鍵＝存全部分頁**；破壞性操作要確認關卡＋連帶清理關聯資料，
    且刪除入口要可見。
11. **外部 fetch 一律 timeout＋retry**；UI 每個數字標註來源與取樣範圍；
    文案（含中英雙語、methodology、PDF）必須與程式實際行為一致；溫差用 °C。
12. **每個 UI 改動 headless 驗證後才交付**；改共用元件檢查所有呼叫端。
