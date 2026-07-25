import puppeteer from "@cloudflare/puppeteer";
import type { BrowserWorker } from "@cloudflare/puppeteer";
import type { ResearchSource } from "./research";

export type PdfReportInput = {
  title: string;
  executiveSummary: string;
  content: string;
  generatedAt: string;
  sourceCutoffAt: string;
  sources: ResearchSource[];
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(S\d+)\]/g, '<span class="citation">[$1]</span>');
}

function tableCells(line: string): string[] {
  return line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function markdownToHtml(value: string): string {
  const rows = value.replace(/\r/g, "").trim().split("\n");
  const html: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let paragraph: string[] = [];
  const closeList = () => {
    if (listType) html.push(`</${listType}>`);
    listType = null;
  };
  const closeParagraph = () => {
    if (paragraph.length) html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeBlocks = () => {
    closeParagraph();
    closeList();
  };

  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index];
    const line = raw.trim();
    if (!line) {
      closeBlocks();
      continue;
    }
    const next = rows[index + 1]?.trim() ?? "";
    if (line.includes("|") && /^\|?\s*:?-{3,}/.test(next)) {
      closeBlocks();
      const headers = tableCells(line);
      index += 1;
      const body: string[][] = [];
      while (index + 1 < rows.length && rows[index + 1].includes("|") && rows[index + 1].trim()) {
        body.push(tableCells(rows[index + 1]));
        index += 1;
      }
      html.push(`<div class="table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${body.map((cells) => `<tr>${headers.map((_header, cellIndex) => `<td>${inlineMarkdown(cells[cellIndex] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (line.startsWith("### ")) {
      closeBlocks();
      html.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      closeBlocks();
      html.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      closeBlocks();
      html.push(`<h2>${inlineMarkdown(line.slice(2))}</h2>`);
    } else if (/^[-*]\s+/.test(line)) {
      closeParagraph();
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`);
    } else if (/^\d+[.)]\s+/.test(line)) {
      closeParagraph();
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${inlineMarkdown(line.replace(/^\d+[.)]\s+/, ""))}</li>`);
    } else if (line.startsWith("> ")) {
      closeBlocks();
      html.push(`<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`);
    } else if (/^[-*_]{3,}$/.test(line)) {
      closeBlocks();
      html.push("<hr>");
    } else {
      closeList();
      paragraph.push(line);
    }
  }
  closeBlocks();
  return html.join("\n");
}

function displayDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

function displayDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

export function reportHtml(input: PdfReportInput): string {
  const cleanContent = input.content.replace(/^\s*#\s+.+(?:\n+|$)/, "").trim();
  const sources = input.sources.map((source, index) => `
    <li>
      <div class="source-title"><strong>[S${index + 1}] ${escapeHtml(source.title)}</strong><span>${escapeHtml(source.publisher)}</span></div>
      <p>${escapeHtml(source.snippet)}</p>
      <a href="${escapeHtml(source.url)}">${escapeHtml(source.url)}</a>
      <small>发布：${escapeHtml(source.publishedAt ? displayDateTime(source.publishedAt) : "未提供")}　采集：${escapeHtml(displayDateTime(source.fetchedAt))}</small>
    </li>`).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 17mm 17mm 20mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #25211e; background: #fffefa; font-family: "Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei","PingFang SC",Arial,sans-serif; font-size: 10.8px; line-height: 1.78; }
  .report-header { padding: 3mm 0 7mm; border-bottom: 1.5px solid #aa2e26; }
  .report-header .category { color: #a52d26; font-weight: 800; letter-spacing: .16em; font-size: 8.5px; }
  .report-header h1 { margin: 5mm 0 4mm; color: #211d1a; font-size: 27px; line-height: 1.25; letter-spacing: -.025em; }
  .meta { display: flex; flex-wrap: wrap; gap: 3mm 8mm; color: #776b64; font-size: 9px; }
  .meta strong { color: #39312c; }
  .summary-section { margin: 8mm 0 9mm; }
  .eyebrow { margin: 0 0 2.5mm; color: #a52d26; font-size: 9px; font-weight: 800; letter-spacing: .13em; }
  .summary { padding: 5mm 6mm; background: #f8f1e8; border-left: 3px solid #b33830; color: #302a26; font-size: 11.5px; }
  .summary p { margin: 0; }
  h2 { break-after: avoid; margin: 10mm 0 4mm; padding-top: 1mm; color: #29231f; font-size: 18px; line-height: 1.4; border-top: 1px solid #ddd3c8; }
  h2:first-child { margin-top: 4mm; }
  h3 { break-after: avoid; margin: 7mm 0 2.5mm; color: #8f2923; font-size: 13px; line-height: 1.45; }
  p { margin: 0 0 3.2mm; text-align: justify; }
  ul, ol { margin: 2mm 0 5mm; padding-left: 6.5mm; }
  li { margin-bottom: 1.8mm; }
  blockquote { margin: 4mm 0; padding: 3mm 4mm; background: #faf5ef; border-left: 2px solid #b33830; color: #5d514a; }
  hr { border: 0; border-top: 1px solid #ddd3c8; margin: 7mm 0; }
  .citation { color: #a52d26; font-weight: 700; white-space: nowrap; }
  code { background: #f3ece3; padding: 0 .8mm; border-radius: 1mm; font-size: 9.5px; }
  .table-wrap { margin: 4mm 0 6mm; break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  th { background: #f3e9de; color: #69211d; text-align: left; font-weight: 800; }
  th, td { padding: 2.3mm 2.5mm; border: 1px solid #ddd1c5; vertical-align: top; }
  tbody tr:nth-child(even) { background: #fdf9f4; }
  .sources-page { break-before: page; }
  .sources { list-style: none; padding: 0; }
  .sources li { break-inside: avoid; padding: 4mm 0; border-bottom: 1px solid #e4dbd2; }
  .source-title { display: flex; justify-content: space-between; gap: 5mm; }
  .source-title span { color: #a52d26; white-space: nowrap; }
  .sources p { color: #625852; margin: 1.5mm 0; text-align: left; }
  .sources a { color: #862a25; font-size: 8.8px; overflow-wrap: anywhere; }
  .sources small { display: block; color: #8e8179; margin-top: 1mm; }
  .method-note { color: #6f625b; }
</style>
</head>
<body>
  <header class="report-header">
    <div class="category">专题研究简报</div>
    <h1>${escapeHtml(input.title)}</h1>
    <div class="meta">
      <span><strong>发布日期</strong> ${escapeHtml(displayDate(input.generatedAt))}</span>
      <span><strong>数据截止</strong> ${escapeHtml(displayDateTime(input.sourceCutoffAt))}</span>
      <span><strong>版本</strong> v1.0</span>
    </div>
  </header>
  <section class="summary-section">
    <p class="eyebrow">执行摘要</p>
    <div class="summary">${markdownToHtml(input.executiveSummary)}</div>
  </section>
  <main>${markdownToHtml(cleanContent)}</main>
  ${input.sources.length ? `<section class="sources-page">
    <p class="eyebrow">数据来源与说明</p>
    <h2>参考资料</h2>
    <p class="method-note">来源按正文引用编号排列。涉及实时变化的数据，应以所列采集时间为口径；无法由公开资料独立验证的判断，均应视为分析假设而非确定事实。</p>
    <ol class="sources">${sources}</ol>
  </section>` : ""}
</body>
</html>`;
}

export async function generateReportPdf(browserBinding: BrowserRun, input: PdfReportInput): Promise<Uint8Array> {
  const browser = await puppeteer.launch(browserBinding as unknown as BrowserWorker);
  try {
    const page = await browser.newPage();
    await page.setContent(reportHtml(input), { waitUntil: "load", timeout: 30_000 });
    const result = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: '<div style="width:100%;font-size:8px;color:#8e8179;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: "8mm", right: "0", bottom: "12mm", left: "0" },
    });
    return new Uint8Array(result);
  } finally {
    await browser.close();
  }
}
