import fs from "fs";
import path from "path";
import {
  Document, Packer, Paragraph, TextRun, PageBreak,
  Header, Footer, AlignmentType, HeadingLevel, PageNumber,
  BorderStyle, LevelFormat, TabStopType, TabStopPosition
} from "docx";

// ─── File manifest: agent → files, ordered Luna→Marco→Sage→Nova→Echo→Pixel ───
const WORKSPACE = "/Users/hans.pan/bitword-workspace";
const DOCS_DIR = "/Users/hans.pan/paperclip/docs";

const manifest = [
  {
    agent: "Luna", role: "CEO / 首席执行官",
    files: [
      { path: `${WORKSPACE}/luna/docs/operations/month1-plan.md`, bit: "BIT-7", title: "首月运营计划" },
      { path: `${WORKSPACE}/luna/docs/meetings/2026-03-17-kickoff-meeting.md`, bit: "BIT-12", title: "首次全员启动会纪要" },
      { path: `${WORKSPACE}/luna/docs/okrs/2026-03-month1-okr.md`, bit: "BIT-12", title: "首月 OKR" },
      { path: `${WORKSPACE}/luna/docs/processes/cross-department-collaboration.md`, bit: "BIT-12", title: "跨部门协作流程" },
      { path: `${WORKSPACE}/luna/docs/processes/weekly-meeting-schedule.md`, bit: "BIT-12", title: "周会排期表" },
    ]
  },
  {
    agent: "Marco", role: "CMO / 首席营销官",
    files: [
      { path: `${WORKSPACE}/marco/docs/marketing/q2-brand-strategy.md`, bit: "BIT-5", title: "Q2 品牌营销策略方案" },
      { path: `${WORKSPACE}/marco/BIT-9-品牌定位与视觉规范.md`, bit: "BIT-9", title: "品牌定位与视觉规范" },
    ]
  },
  {
    agent: "Sage", role: "内容主编",
    files: [
      { path: `${WORKSPACE}/sage/docs/content-style-guide.md`, bit: "BIT-2", title: "内容风格指南" },
      { path: `${WORKSPACE}/sage/content-planning/content-topics-library.md`, bit: "BIT-8", title: "内容选题库" },
      { path: `${WORKSPACE}/sage/content-planning/content-production-sop.md`, bit: "BIT-8", title: "内容生产 SOP" },
      { path: `${WORKSPACE}/sage/content-planning/content-quality-scoring.md`, bit: "BIT-8", title: "内容质量评分标准" },
    ]
  },
  {
    agent: "Nova", role: "CTO / 首席技术官",
    files: [
      { path: `${DOCS_DIR}/tech/system-health-report.md`, bit: "BIT-6", title: "系统健康检查与优化报告" },
      { path: `${WORKSPACE}/nova/tech-stack-selection.md`, bit: "BIT-10", title: "技术栈选型文档" },
      { path: `${WORKSPACE}/nova/database-schema.md`, bit: "BIT-10", title: "数据库 Schema 设计" },
      { path: `${WORKSPACE}/nova/bitword-cms/README.md`, bit: "BIT-10", title: "CMS 项目 README" },
      { path: `${WORKSPACE}/nova/bitword-cms/docs/development-setup.md`, bit: "BIT-10", title: "开发环境搭建指南" },
      { path: `${WORKSPACE}/nova/bitword-cms/docs/git-workflow.md`, bit: "BIT-10", title: "Git 工作流规范" },
    ]
  },
  {
    agent: "Echo", role: "舆情分析师",
    files: [
      { path: `${WORKSPACE}/echo/docs/templates/daily-sentiment-report-template.md`, bit: "BIT-4", title: "每日舆情报告模板" },
      { path: `${WORKSPACE}/echo/docs/reports/sentiment-2026-03-17.md`, bit: "BIT-4", title: "舆情日报 (2026-03-17)" },
      { path: `${WORKSPACE}/echo/舆情周报模板.md`, bit: "BIT-4", title: "舆情周报模板" },
      { path: `${WORKSPACE}/echo/舆情监控指标体系.md`, bit: "BIT-11", title: "舆情监控指标体系" },
      { path: `${WORKSPACE}/echo/舆情监控数据源清单.md`, bit: "BIT-11", title: "舆情监控数据源清单" },
      { path: `${WORKSPACE}/echo/Web3舆情周报_2026W11.md`, bit: "BIT-11", title: "Web3 舆情周报 (2026-W11)" },
    ]
  },
  {
    agent: "Pixel", role: "高级内容创作者",
    files: [
      { path: `${WORKSPACE}/pixel/docs/articles/tron-2026-ecosystem.md`, bit: "BIT-3", title: "TRON 2026 生态全景解读" },
    ]
  },
];

const totalFiles = manifest.reduce((sum, g) => sum + g.files.length, 0);

// ─── Markdown-to-paragraph converter ───
function mdToParagraphs(content) {
  const paragraphs = [];
  const lines = content.split("\n");
  let inCodeBlock = false;
  let codeBuffer = [];
  let inTable = false;
  let tableRows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block toggle
    if (line.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        // End code block
        const codeText = codeBuffer.join("\n");
        paragraphs.push(
          new Paragraph({
            spacing: { before: 60, after: 60 },
            shading: { type: "clear", fill: "F5F5F5" },
            border: {
              top: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
              left: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
              right: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
            },
            children: [new TextRun({ text: codeText, font: "Courier New", size: 18 })],
          })
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Table detection
    if (line.includes("|") && line.trim().startsWith("|")) {
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      // Skip separator rows
      if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;
      tableRows.push(line);
      continue;
    } else if (inTable) {
      // Flush table as formatted text
      for (const row of tableRows) {
        paragraphs.push(new Paragraph({
          spacing: { before: 20, after: 20 },
          children: [new TextRun({ text: row.trim(), font: "Courier New", size: 18 })],
        }));
      }
      inTable = false;
      tableRows = [];
    }

    // Empty line
    if (line.trim() === "") {
      paragraphs.push(new Paragraph({ spacing: { before: 60, after: 60 }, children: [] }));
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].replace(/[*_`#]/g, "");
      const headingLevel = level === 1 ? HeadingLevel.HEADING_2
        : level === 2 ? HeadingLevel.HEADING_3
        : level === 3 ? HeadingLevel.HEADING_4
        : HeadingLevel.HEADING_5;
      paragraphs.push(new Paragraph({
        heading: headingLevel,
        children: [new TextRun({ text, bold: true })],
      }));
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      paragraphs.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC", space: 4 } },
        spacing: { before: 120, after: 120 },
        children: [],
      }));
      continue;
    }

    // List items
    const listMatch = line.match(/^(\s*)([-*+]|\d+[.)]) (.+)/);
    if (listMatch) {
      const indent = Math.floor(listMatch[1].length / 2);
      const bullet = listMatch[1].length > 0 ? "  ".repeat(indent) + "\u2022 " : "\u2022 ";
      const textContent = listMatch[3].replace(/\*\*(.+?)\*\*/g, "$1").replace(/[`_]/g, "");
      const isNumbered = /^\d+[.)]/.test(listMatch[2]);
      const prefix = isNumbered ? listMatch[2] + " " : bullet;
      paragraphs.push(new Paragraph({
        spacing: { before: 40, after: 40 },
        indent: { left: 360 + indent * 360 },
        children: parseInlineFormatting(prefix + textContent),
      }));
      continue;
    }

    // Regular paragraph
    const cleanLine = line.replace(/!\[.*?\]\(.*?\)/g, "[图片]"); // image placeholder
    paragraphs.push(new Paragraph({
      spacing: { before: 60, after: 60 },
      children: parseInlineFormatting(cleanLine),
    }));
  }

  // Flush remaining table
  if (inTable) {
    for (const row of tableRows) {
      paragraphs.push(new Paragraph({
        spacing: { before: 20, after: 20 },
        children: [new TextRun({ text: row.trim(), font: "Courier New", size: 18 })],
      }));
    }
  }

  return paragraphs;
}

// Parse **bold**, *italic*, `code` inline
function parseInlineFormatting(text) {
  const runs = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index), size: 22, font: "Arial" }));
    }
    if (match[2]) {
      runs.push(new TextRun({ text: match[2], bold: true, size: 22, font: "Arial" }));
    } else if (match[3]) {
      runs.push(new TextRun({ text: match[3], italics: true, size: 22, font: "Arial" }));
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], font: "Courier New", size: 20, shading: { type: "clear", fill: "F0F0F0" } }));
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex), size: 22, font: "Arial" }));
  }
  if (runs.length === 0) {
    runs.push(new TextRun({ text, size: 22, font: "Arial" }));
  }
  return runs;
}

// ─── Build DOCX ───
async function buildDocx() {
  const sections = [];

  // === Cover page section ===
  sections.push({
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children: [
      new Paragraph({ spacing: { before: 4000 }, children: [] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [new TextRun({ text: "BitWord", size: 72, bold: true, font: "Arial", color: "2E75B6" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: "Agent 成果汇总", size: 48, bold: true, font: "Arial" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "2E75B6", space: 8 } },
        spacing: { after: 600 },
        children: [],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: "Web3 行业智能内容工厂", size: 28, font: "Arial", color: "666666", italics: true })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({ text: `文档总数：${totalFiles} 篇`, size: 24, font: "Arial", color: "333333" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({ text: `Agent 数量：${manifest.length} 位`, size: 24, font: "Arial", color: "333333" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({ text: `生成日期：2026 年 3 月 17 日`, size: 24, font: "Arial", color: "333333" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 2000 },
        children: [new TextRun({ text: "Powered by Paperclip AI Agent Control Plane", size: 20, font: "Arial", color: "999999" })],
      }),
    ],
  });

  // === Table of Contents section ===
  const tocChildren = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 400 },
      children: [new TextRun({ text: "目录", bold: true, size: 36, font: "Arial" })],
    }),
  ];

  for (const group of manifest) {
    tocChildren.push(new Paragraph({
      spacing: { before: 240, after: 120 },
      children: [new TextRun({ text: `${group.agent}（${group.role}）`, bold: true, size: 26, font: "Arial", color: "2E75B6" })],
    }));
    for (const file of group.files) {
      tocChildren.push(new Paragraph({
        spacing: { before: 40, after: 40 },
        indent: { left: 480 },
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        children: [
          new TextRun({ text: `${file.bit}  ${file.title}`, size: 22, font: "Arial" }),
        ],
      }));
    }
  }

  sections.push({
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: "BitWord Agent 成果汇总", size: 18, font: "Arial", color: "999999", italics: true })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "第 ", size: 18, font: "Arial", color: "999999" }), new TextRun({ children: [PageNumber.CURRENT], size: 18, font: "Arial", color: "999999" }), new TextRun({ text: " 页", size: 18, font: "Arial", color: "999999" })],
        })],
      }),
    },
    children: tocChildren,
  });

  // === Content sections: one section per file ===
  for (const group of manifest) {
    for (let fi = 0; fi < group.files.length; fi++) {
      const file = group.files[fi];
      const content = fs.readFileSync(file.path, "utf-8");
      const stat = fs.statSync(file.path);
      const sizeKB = (stat.size / 1024).toFixed(1);
      const relPath = file.path.replace("/Users/hans.pan/", "");

      const children = [];

      // Chapter header
      children.push(new Paragraph({
        spacing: { before: 200, after: 100 },
        border: {
          top: { style: BorderStyle.DOUBLE, size: 2, color: "2E75B6", space: 4 },
          bottom: { style: BorderStyle.DOUBLE, size: 2, color: "2E75B6", space: 4 },
        },
        alignment: AlignmentType.CENTER,
        children: [new TextRun({
          text: `${group.agent}  |  ${file.bit}  |  ${file.title}`,
          bold: true, size: 28, font: "Arial", color: "2E75B6",
        })],
      }));

      // Metadata
      children.push(new Paragraph({
        spacing: { before: 80, after: 40 },
        children: [
          new TextRun({ text: "文件路径：", bold: true, size: 20, font: "Arial", color: "666666" }),
          new TextRun({ text: relPath, size: 20, font: "Courier New", color: "666666" }),
        ],
      }));
      children.push(new Paragraph({
        spacing: { before: 40, after: 120 },
        children: [
          new TextRun({ text: "文件大小：", bold: true, size: 20, font: "Arial", color: "666666" }),
          new TextRun({ text: `${sizeKB} KB`, size: 20, font: "Arial", color: "666666" }),
        ],
      }));

      // Divider
      children.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC", space: 4 } },
        spacing: { after: 200 },
        children: [],
      }));

      // Document content
      const contentParagraphs = mdToParagraphs(content);
      children.push(...contentParagraphs);

      sections.push({
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        headers: {
          default: new Header({
            children: [new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD", space: 2 } },
              children: [
                new TextRun({ text: `${group.agent} (${group.role})`, size: 18, font: "Arial", color: "2E75B6", bold: true }),
                new TextRun({ text: `    ${file.bit} | ${file.title}`, size: 18, font: "Arial", color: "999999" }),
              ],
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "BitWord Agent 成果汇总  |  第 ", size: 16, font: "Arial", color: "AAAAAA" }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, font: "Arial", color: "AAAAAA" }),
                new TextRun({ text: " 页", size: 16, font: "Arial", color: "AAAAAA" }),
              ],
            })],
          }),
        },
        children,
      });
    }
  }

  const doc = new Document({
    creator: "BitWord / Paperclip",
    title: "BitWord Agent 成果汇总",
    description: "BitWord 全部 Agent 产出文档合并",
    styles: {
      default: {
        document: { run: { font: "Arial", size: 22 } },
      },
      paragraphStyles: [
        {
          id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 36, bold: true, font: "Arial", color: "2E75B6" },
          paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 },
        },
        {
          id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 30, bold: true, font: "Arial", color: "333333" },
          paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 },
        },
        {
          id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 26, bold: true, font: "Arial", color: "444444" },
          paragraph: { spacing: { before: 220, after: 120 }, outlineLevel: 2 },
        },
        {
          id: "Heading4", name: "Heading 4", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 24, bold: true, font: "Arial", color: "555555" },
          paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 3 },
        },
        {
          id: "Heading5", name: "Heading 5", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 22, bold: true, font: "Arial", color: "666666" },
          paragraph: { spacing: { before: 140, after: 80 }, outlineLevel: 4 },
        },
      ],
    },
    sections,
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync("/Users/hans.pan/paperclip/BitWorld_全部成果汇总.docx", buffer);
  console.log(`DOCX written: ${(buffer.length / 1024).toFixed(0)} KB`);
}

// ─── Build Markdown ───
function buildMarkdown() {
  const lines = [];

  // Cover
  lines.push("═".repeat(60));
  lines.push("");
  lines.push("              BitWord Agent 成果汇总");
  lines.push("              Web3 行业智能内容工厂");
  lines.push("");
  lines.push(`              文档总数：${totalFiles} 篇`);
  lines.push(`              Agent 数量：${manifest.length} 位`);
  lines.push(`              生成日期：2026 年 3 月 17 日`);
  lines.push("");
  lines.push("═".repeat(60));
  lines.push("\n");

  // TOC
  lines.push("# 目录\n");
  for (const group of manifest) {
    lines.push(`## ${group.agent}（${group.role}）`);
    for (const file of group.files) {
      lines.push(`  - ${file.bit}  ${file.title}`);
    }
    lines.push("");
  }

  lines.push("\n" + "═".repeat(60) + "\n");

  // Content
  for (const group of manifest) {
    for (const file of group.files) {
      const content = fs.readFileSync(file.path, "utf-8");
      const stat = fs.statSync(file.path);
      const sizeKB = (stat.size / 1024).toFixed(1);
      const relPath = file.path.replace("/Users/hans.pan/", "");

      lines.push("\n" + "═".repeat(60));
      lines.push(`═══ [${group.agent}] | [${file.bit}] | [${file.title}] ═══`);
      lines.push("═".repeat(60));
      lines.push(`文件路径：${relPath}`);
      lines.push(`文件大小：${sizeKB} KB`);
      lines.push("─".repeat(60));
      lines.push("");
      lines.push(content);
      lines.push("\n");
    }
  }

  lines.push("═".repeat(60));
  lines.push("                    ─── 文档结束 ───");
  lines.push("═".repeat(60));

  const md = lines.join("\n");
  fs.writeFileSync("/Users/hans.pan/paperclip/BitWorld_全部成果汇总.md", md);
  console.log(`MD written: ${(Buffer.byteLength(md) / 1024).toFixed(0)} KB`);
}

// ─── Main ───
buildMarkdown();
await buildDocx();
console.log("Done!");
