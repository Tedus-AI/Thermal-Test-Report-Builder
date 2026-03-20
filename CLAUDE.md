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

