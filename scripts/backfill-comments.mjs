import fs from "fs";

const API = "http://localhost:3100/api";

const backfills = [
  {
    issueId: "918ad2be-8cb3-440e-bc66-b6ce125f52dd",
    identifier: "BIT-2",
    title: "制定 BitWorld 内容风格指南",
    files: [
      { path: "/Users/hans.pan/bitword-workspace/sage/docs/content-style-guide.md", label: "内容风格指南" },
    ],
  },
  {
    issueId: "3692d11f-62e0-4a14-804c-3fb588ab9b25",
    identifier: "BIT-3",
    title: "撰写首篇深度文章：TRON 2026 生态全景解读",
    files: [
      { path: "/Users/hans.pan/bitword-workspace/pixel/docs/articles/tron-2026-ecosystem.md", label: "TRON 2026 生态全景解读" },
    ],
  },
  {
    issueId: "25f88829-bb19-4af6-9476-3fd571526080",
    identifier: "BIT-4",
    title: "建立舆情日报模板并产出首份报告",
    files: [
      { path: "/Users/hans.pan/bitword-workspace/echo/docs/templates/daily-sentiment-report-template.md", label: "每日舆情报告模板" },
      { path: "/Users/hans.pan/bitword-workspace/echo/docs/reports/sentiment-2026-03-17.md", label: "舆情日报 (2026-03-17)" },
    ],
  },
  {
    issueId: "3df24a5a-aa0b-4e99-84f6-679696ee0807",
    identifier: "BIT-8",
    title: "制定内容选题库与生产 SOP",
    files: [
      { path: "/Users/hans.pan/bitword-workspace/sage/content-planning/content-topics-library.md", label: "内容选题库" },
      { path: "/Users/hans.pan/bitword-workspace/sage/content-planning/content-production-sop.md", label: "内容生产 SOP" },
      { path: "/Users/hans.pan/bitword-workspace/sage/content-planning/content-quality-scoring.md", label: "内容质量评分标准" },
    ],
  },
];

async function postComment(issueId, body) {
  const res = await fetch(`${API}/issues/${issueId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST comments failed ${res.status}: ${text}`);
  }
  return res.json();
}

for (const item of backfills) {
  console.log(`\n━━━ ${item.identifier}: ${item.title} ━━━`);

  // Build comment body
  const parts = [`## 交付成果\n`];

  for (const file of item.files) {
    const content = fs.readFileSync(file.path, "utf-8");
    const relPath = file.path.replace("/Users/hans.pan/", "");
    const sizeKB = (fs.statSync(file.path).size / 1024).toFixed(1);

    parts.push(`### ${file.label}\n`);
    parts.push(`**文件路径：** \`${relPath}\` (${sizeKB} KB)\n`);
    parts.push(`---\n`);
    parts.push(content);
    parts.push(`\n\n`);
  }

  const body = parts.join("\n");
  console.log(`  内容长度: ${body.length} 字符, ${item.files.length} 个文件`);

  try {
    const result = await postComment(item.issueId, body);
    console.log(`  ✅ 回贴成功 (comment id: ${result.id})`);
  } catch (err) {
    console.error(`  ❌ 回贴失败: ${err.message}`);
  }
}

console.log("\n✅ 全部完成");
