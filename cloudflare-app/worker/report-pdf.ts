import puppeteer from "@cloudflare/puppeteer";
import type { BrowserWorker } from "@cloudflare/puppeteer";
import type { ResearchSource } from "./research";

export type PdfReportInput = {
  title: string;
  objective: string;
  executiveSummary: string;
  content: string;
  generatedAt: string;
  sourceCutoffAt: string;
  workflowId: string;
  ceoPlan: string;
  participants: string[];
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
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function markdownToHtml(value: string): string {
  const rows = value.replace(/\r/g, "").split("\n");
  const html: string[] = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) html.push("</ul>");
    listOpen = false;
  };
  for (const raw of rows) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (line.startsWith("### ")) {
      closeList();
      html.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      closeList();
      html.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      closeList();
      html.push(`<h2>${inlineMarkdown(line.slice(2))}</h2>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (!listOpen) html.push("<ul>");
      listOpen = true;
      html.push(`<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`);
    } else {
      closeList();
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeList();
  return html.join("\n");
}

function reportHtml(input: PdfReportInput): string {
  const sources = input.sources.map((source, index) => `
    <li>
      <div><strong>[S${index + 1}] ${escapeHtml(source.title)}</strong><span>${escapeHtml(source.publisher)}</span></div>
      <p>${escapeHtml(source.snippet)}</p>
      <a href="${escapeHtml(source.url)}">${escapeHtml(source.url)}</a>
      <small>发布时间：${escapeHtml(source.publishedAt ?? "未提供")}　抓取：${escapeHtml(source.fetchedAt)}</small>
    </li>`).join("");
  const participants = input.participants.map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #34251f; background: #fffdf8; font-family: "Noto Sans CJK SC","Microsoft YaHei","PingFang SC",Arial,sans-serif; font-size: 11px; line-height: 1.72; }
  .cover { min-height: 246mm; display: flex; flex-direction: column; padding: 14mm 8mm 8mm; border-top: 7px solid #ae332b; }
  .brand { color: #a52f28; font-weight: 800; letter-spacing: .18em; font-size: 10px; }
  .cover h1 { margin: 44mm 0 7mm; max-width: 150mm; color: #2d201b; font-size: 31px; line-height: 1.22; letter-spacing: -.03em; }
  .objective { font-size: 14px; color: #6e5d53; max-width: 150mm; }
  .cover-grid { margin-top: auto; padding-top: 8mm; border-top: 1px solid #ddcdbd; display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
  .cover-grid small, .meta small { display: block; color: #9d8172; font-weight: 700; letter-spacing: .08em; margin-bottom: 2mm; }
  .cover-grid strong { font-size: 12px; }
  .page-break { break-before: page; }
  .eyebrow { color: #a52f28; font-size: 9px; font-weight: 800; letter-spacing: .14em; margin: 0 0 2mm; }
  h2 { color: #35231d; font-size: 20px; line-height: 1.35; margin: 10mm 0 4mm; padding-bottom: 2mm; border-bottom: 1px solid #eadfd2; }
  h3 { color: #7f241f; font-size: 14px; margin: 7mm 0 2mm; }
  p { margin: 0 0 3.2mm; }
  ul { margin: 2mm 0 5mm; padding-left: 6mm; }
  li { margin-bottom: 2mm; }
  .summary { margin: 5mm 0 8mm; padding: 6mm; background: #f8ece5; border-left: 4px solid #b33b32; border-radius: 2mm; font-size: 13px; }
  .trace { display: flex; flex-wrap: wrap; gap: 2mm; margin: 4mm 0 8mm; }
  .trace span { background: #f4e8df; border: 1px solid #dec8b6; border-radius: 9mm; padding: 1.5mm 3mm; color: #75483b; }
  .plan { background: #fbf6ee; border: 1px solid #eadac9; padding: 5mm; border-radius: 3mm; }
  .plan p:last-child, .plan ul:last-child { margin-bottom: 0; }
  .sources { list-style: none; padding: 0; }
  .sources li { break-inside: avoid; padding: 4mm 0; border-bottom: 1px solid #eadfd2; }
  .sources div { display: flex; justify-content: space-between; gap: 5mm; }
  .sources div span { color: #a52f28; white-space: nowrap; }
  .sources p { color: #6e5d53; margin: 1.5mm 0; }
  .sources a { color: #8d2c27; font-size: 9px; overflow-wrap: anywhere; }
  .sources small { display: block; color: #9a897f; margin-top: 1mm; }
  code { background: #f3e8dd; padding: 0 .8mm; border-radius: 1mm; }
  footer { margin-top: 10mm; padding-top: 3mm; border-top: 1px solid #eadfd2; color: #927c70; font-size: 9px; }
</style>
</head>
<body>
  <section class="cover">
    <div class="brand">BITWORLD · 董事会秘书处</div>
    <h1>${escapeHtml(input.title)}</h1>
    <div class="objective">${escapeHtml(input.objective)}</div>
    <div class="cover-grid">
      <div><small>成果形式</small><strong>决策摘要 + 完整方案</strong></div>
      <div><small>数据截止</small><strong>${escapeHtml(input.sourceCutoffAt)}</strong></div>
      <div><small>生成时间</small><strong>${escapeHtml(input.generatedAt)}</strong></div>
      <div><small>工作流编号</small><strong>${escapeHtml(input.workflowId)}</strong></div>
    </div>
  </section>
  <section class="page-break">
    <p class="eyebrow">执行摘要</p>
    <div class="summary">${inlineMarkdown(input.executiveSummary)}</div>
    <h2>责任链与执行范围</h2>
    <div class="trace">${participants}</div>
    <h3>集团 CEO 统筹方案</h3>
    <div class="plan">${markdownToHtml(input.ceoPlan)}</div>
    ${markdownToHtml(input.content)}
  </section>
  <section class="page-break">
    <p class="eyebrow">证据与时效</p>
    <h2>实时来源清单</h2>
    <p>本报告涉及外部事实、价格、日期与事件时，以以下来源及其抓取时间为准。新闻标题用于提供检索线索，不等同于对报道内容的独立事实核验。</p>
    <ol class="sources">${sources}</ol>
    <footer>BitWorld 自动生成 · 董秘交付 · 集团 CEO 统筹 · 事业部专业执行</footer>
  </section>
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
      footerTemplate: '<div style="width:100%;font-size:8px;color:#9a897f;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: "10mm", right: "0", bottom: "12mm", left: "0" },
    });
    return new Uint8Array(result);
  } finally {
    await browser.close();
  }
}
