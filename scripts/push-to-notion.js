#!/usr/bin/env node
import "dotenv/config";
import { readFile, readdir } from "fs/promises";
import { join, basename } from "path";
import { existsSync } from "fs";

// ============================================================================
// Follow Builders — Push Report to Notion
// ============================================================================
// Reads an investment report markdown file, creates a database entry in Notion
// (title / date / summary properties) and appends the full report as page
// content blocks.
//
// Usage: node push-to-notion.js [path/to/report.md]
//        (defaults to the newest *-investment-report.md under reports/)
//
// Env vars needed: NOTION_TOKEN, NOTION_DATABASE_ID
// ============================================================================

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_VERSION = "2022-06-28";
const API = "https://api.notion.com/v1";

const ROOT = process.cwd();
const REPORT_DIR = join(ROOT, "reports");

function headers() {
  return {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

// -- Inline markdown -> Notion rich_text --------------------------------------
// Handles [link](url), **bold**, `code`, *italic*, and plain text.
function parseInline(text) {
  const tokens = [];
  const regex =
    /(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)/g;
  let last = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) {
      tokens.push({ type: "text", text: { content: text.slice(last, m.index) } });
    }
    if (m[1]) {
      tokens.push({ type: "text", text: { content: m[2], link: { url: m[3] } } });
    } else if (m[4]) {
      tokens.push({
        type: "text",
        text: { content: m[5] },
        annotations: { bold: true },
      });
    } else if (m[6]) {
      tokens.push({
        type: "text",
        text: { content: m[7] },
        annotations: { code: true },
      });
    } else if (m[8]) {
      tokens.push({
        type: "text",
        text: { content: m[9] },
        annotations: { italic: true },
      });
    }
    last = regex.lastIndex;
  }
  if (last < text.length) {
    tokens.push({ type: "text", text: { content: text.slice(last) } });
  }
  return tokens;
}

// -- Block-level markdown -> Notion blocks -----------------------------------
function mdToBlocks(md) {
  const blocks = [];
  for (const raw of md.split("\n")) {
    const t = raw.trim();
    if (!t) continue;

    if (/^(-{3,}|\*{3,})$/.test(t)) {
      blocks.push({ object: "block", type: "divider", divider: {} });
      continue;
    }

    let m = t.match(/^(#{1,3})\s+(.*)$/);
    if (m) {
      const type = ["heading_1", "heading_2", "heading_3"][m[1].length - 1];
      blocks.push({
        object: "block",
        type,
        [type]: { rich_text: parseInline(m[2]) },
      });
      continue;
    }

    m = t.match(/^[-*]\s+(.*)$/);
    if (m) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: parseInline(m[1]) },
      });
      continue;
    }

    m = t.match(/^\d+[.)]\s+(.*)$/);
    if (m) {
      blocks.push({
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: parseInline(m[1]) },
      });
      continue;
    }

    m = t.match(/^>\s?(.*)$/);
    if (m) {
      blocks.push({
        object: "block",
        type: "quote",
        quote: { rich_text: parseInline(m[1]) },
      });
      continue;
    }

    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: parseInline(t) },
    });
  }
  return blocks;
}

// -- Summary: text of section 一 between "## 一、" and "## 二、" --------------
function extractSummary(md) {
  const start = md.indexOf("## 一、");
  if (start === -1) return "";
  const end = md.indexOf("## 二、");
  const section = end === -1 ? md.slice(start) : md.slice(start, end);

  return section
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith("##") &&
        !l.startsWith("(事实)") &&
        !l.startsWith("(判断)") &&
        !/^(-{3,}|\*{3,})$/.test(l),
    )
    .map((l) => l.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"))
    .join(" ")
    .slice(0, 1500);
}

async function notionFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, { ...options, headers: headers() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Notion API ${res.status}: ${data.code || ""} ${data.message || JSON.stringify(data)}`,
    );
  }
  return data;
}

async function main() {
  if (!NOTION_TOKEN) throw new Error("NOTION_TOKEN 未设置（检查 .env）");
  if (!NOTION_DATABASE_ID)
    throw new Error("NOTION_DATABASE_ID 未设置（检查 .env）");

  // Resolve report file: explicit arg, else newest report in reports/
  let reportPath = process.argv[2];
  if (!reportPath) {
    const files = (await readdir(REPORT_DIR))
      .filter((f) => f.endsWith("-investment-report.md"))
      .sort();
    if (files.length === 0) throw new Error(`reports/ 下没有报告文件`);
    reportPath = join(REPORT_DIR, files[files.length - 1]);
  }
  if (!existsSync(reportPath)) throw new Error(`报告文件不存在: ${reportPath}`);

  const md = await readFile(reportPath, "utf-8");
  const date = basename(reportPath).slice(0, 10);
  const title = `AI投资日报 ${date}`;
  const summary = extractSummary(md);

  // 1. Create the database entry
  console.log(`创建条目: ${title}`);
  const page = await notionFetch("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: NOTION_DATABASE_ID },
      properties: {
        标题: { title: [{ text: { content: title } }] },
        日期: { date: { start: date } },
        摘要: { rich_text: [{ text: { content: summary } }] },
      },
    }),
  });

  const pageId = page.id;

  // 2. Append report content as page blocks (batched 100 at a time)
  const blocks = mdToBlocks(md);
  console.log(`追加 ${blocks.length} 个内容块...`);
  for (let i = 0; i < blocks.length; i += 100) {
    await notionFetch(`/blocks/${pageId}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children: blocks.slice(i, i + 100) }),
    });
  }

  console.log(`✅ 已保存到 Notion: ${page.url || pageId}`);
}

main().catch((err) => {
  console.error("❌ 失败:", err.message);
  process.exit(1);
});
