#!/usr/bin/env node

/**
 * BitWorld 董秘 Telegram Bot v2.0
 *
 * 功能：
 * 1. 轮询 Telegram 消息 → 创建 Paperclip 事项 → 分配给 HQ-001-CEO → 触发执行
 * 2. 任务链路追踪：30s 后查询子事项分配情况并推送
 * 3. Inline Keyboard 交互：PDF 按需生成与发送
 *
 * 用法：node scripts/telegram-bot.mjs
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const BOT_TOKEN = '***REMOVED_FROM_PUBLIC_HISTORY***';
const AUTHORIZED_CHAT_ID = '***REMOVED_FROM_PUBLIC_HISTORY***';
const PAPERCLIP_URL = 'http://localhost:3100';
const POLL_INTERVAL_MS = 30_000; // 30 秒

let lastUpdateId = 0;
let companyId = null;
let ceoId = null;

/* ─── 消息去重（防止同一条TG消息被处理两次） ─── */
const processedMessages = new Set();

/* ─── PDF 文件路径缓存（callback_data 有 64 字节限制） ─── */
const pdfPathCache = new Map(); // id → filePath

/* ─── 产出文件追踪 Map（Agent 完成消息 → 实际文件路径） ─── */
const reportFileMap = new Map(); // key(各种) → absoluteFilePath

/**
 * 从 TG 消息中提取产出文件路径并追踪。
 * Agent 完成任务后发的消息通常包含 "产出文件：xxx.md" 或 "📁 产出文件：xxx"
 */
function trackReportFile(msgText) {
  if (!msgText) return;
  const fileMatch = msgText.match(/产出文件[：:]\s*[^\n]*?([^\s/]+\.md)/);
  if (!fileMatch) return;
  const fileName = fileMatch[1].trim();
  const today = new Date().toISOString().split('T')[0];
  const todayDir = `/Users/hans.pan/bitworld-output/${today}`;
  try {
    const found = execSync(
      `find "${todayDir}" -name "*${fileName.replace(/['"]/g, '')}*" -type f 2>/dev/null | head -1`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    if (found && existsSync(found)) {
      reportFileMap.set(fileName, found);
      reportFileMap.set('latest', found);
      // 也用文件名的关键词做 key
      const baseName = fileName.replace(/\.md$/, '').replace(/[_\-]/g, ' ');
      for (const kw of baseName.split(/\s+/).filter(w => w.length > 1)) {
        reportFileMap.set(kw, found);
      }
      console.log(`[文件追踪] ${fileName} → ${found}`);
      return found;
    }
    // 如果精确文件名没找到，用文件名中的核心词搜索
    const coreWords = fileName.replace(/\.md$/, '').replace(/[_\-\d]/g, ' ').split(/\s+/).filter(w => w.length > 1);
    if (coreWords.length > 0) {
      const searchWord = coreWords[0];
      const fuzzy = execSync(
        `find "${todayDir}" -name "*${searchWord}*" -name "*.md" -type f -exec stat -f "%m %N" {} \\; 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      if (fuzzy && existsSync(fuzzy)) {
        reportFileMap.set(fileName, fuzzy);
        reportFileMap.set('latest', fuzzy);
        console.log(`[文件追踪] 模糊匹配 "${searchWord}" → ${fuzzy}`);
        return fuzzy;
      }
    }
  } catch (e) { console.error('[文件追踪] 失败:', e.message); }
}

/**
 * 从 callback_data 或 reportFileMap 中找到精确的 MD 文件。
 * 优先用 Map 追踪结果，其次 smartFindMd fallback。
 */
function resolveReportFile(relPath) {
  const baseDir = '/Users/hans.pan/bitworld-output';
  let mdFile = `${baseDir}/${relPath}`;

  // 1. 精确路径
  if (existsSync(mdFile)) return mdFile;

  // 2. 从 reportFileMap 按文件名查找
  const searchName = relPath.split('/').pop()?.replace('.md', '') || '';
  if (reportFileMap.has(searchName + '.md')) return reportFileMap.get(searchName + '.md');
  // 用文件名片段搜索 Map
  for (const [key, val] of reportFileMap) {
    if (searchName && key.includes(searchName)) return val;
    if (searchName && val.includes(searchName)) return val;
  }
  // 用路径中的关键词搜索 Map
  const pathWords = relPath.replace(/[\/\\\-_\.]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  for (const word of pathWords) {
    if (reportFileMap.has(word)) return reportFileMap.get(word);
  }

  // 3. smartFindMd fallback
  const smart = smartFindMd(baseDir, relPath);
  if (existsSync(smart)) return smart;

  return mdFile; // return original even if not found
}

/* ─── 智能文件查找（按关键词匹配） ─── */
function smartFindMd(baseDir, relPath) {
  const today = new Date().toISOString().split('T')[0];
  const todayDir = `${baseDir}/${today}`;
  const pathLower = relPath.toLowerCase();
  try {
    // 0. 按目录匹配
    const dirMatch = relPath.match(/\/([\u4e00-\u9fff]+-[A-Za-z]+)\//);
    let searchDir = todayDir;
    if (dirMatch && existsSync(`${todayDir}/${dirMatch[1]}`)) searchDir = `${todayDir}/${dirMatch[1]}`;

    // 1. 模糊匹配：从路径中提取关键字片段，与所有文件名计算匹配分数
    const pathParts = relPath
      .replace(/[\/\\._-]/g, ' ')
      .replace(/([a-zA-Z]+)/g, ' $1 ')  // 分离英文单词
      .replace(/\d{4}/g, '')  // 去年份
      .replace(/\b\d{1,2}\b/g, '')  // 去月日
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w.length > 1 && !/^(md|CEO|CTO|CHO|CFO|pdf|yes|no)$/i.test(w));
    const allFiles = execSync(`find "${searchDir}" -name "*.md" -not -name "README.md" -type f 2>/dev/null`, {encoding:'utf-8',timeout:5000}).trim().split('\n').filter(Boolean);

    if (allFiles.length > 0 && pathParts.length > 0) {
      let bestMatch = '';
      let bestScore = 0;
      for (const f of allFiles) {
        const fname = f.toLowerCase();
        let score = 0;
        for (const kw of pathParts) {
          if (fname.includes(kw.toLowerCase())) score++;
        }
        if (score > bestScore) {
          bestScore = score;
          bestMatch = f;
        }
      }
      if (bestScore >= 2 && bestMatch && existsSync(bestMatch)) {
        console.log(`[SmartFind] 模糊匹配 score=${bestScore} parts=[${pathParts.join(',')}] → ${bestMatch}`);
        return bestMatch;
      }
    }

    // 2. 固定关键词匹配（fallback）
    let kw = '';
    if (pathLower.includes('加密') || pathLower.includes('crypto')) kw = '加密';
    else if (pathLower.includes('科技') || pathLower.includes('tech')) kw = '科技';
    else if (pathLower.includes('舆情') || pathLower.includes('sentiment') || pathLower.includes('孙宇晨')) kw = '舆情';
    else if (pathLower.includes('新闻') || pathLower.includes('news') || pathLower.includes('热点')) kw = '新闻';
    else if (pathLower.includes('人力') || pathLower.includes('cho')) kw = '人力';
    else if (pathLower.includes('成本') || pathLower.includes('cfo')) kw = '成本';
    let found = '';
    if (kw) {
      found = execSync(`find "${searchDir}" -name "*${kw}*" -name "*.md" -not -name "README.md" -type f -exec stat -f "%m %N" {} \\; 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-`, {encoding:'utf-8',timeout:5000}).trim();
    }

    // 3. 目录内最新
    if (!found && searchDir !== todayDir) {
      found = execSync(`find "${searchDir}" -name "*.md" -not -name "README.md" -type f -exec stat -f "%m %N" {} \\; 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-`, {encoding:'utf-8',timeout:5000}).trim();
    }
    // 4. 全局最新
    if (!found) {
      found = execSync(`find "${todayDir}" -name "*.md" -not -name "README.md" -type f -exec stat -f "%m %N" {} \\; 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-`, {encoding:'utf-8',timeout:5000}).trim();
    }
    if (found && existsSync(found)) {
      console.log(`[SmartFind] kw="${kw}" → ${found}`);
      return found;
    }
  } catch (e) { console.error('[SmartFind] 失败:', e.message); }
  return `${baseDir}/${relPath}`;
}

/* ─── 预设邮箱配置 ─── */
const PRESET_EMAILS = [
  { label: '主邮箱', email: 'hans.pan007@gmail.com' },
];
let pdfIdCounter = 0;

function storePdfPath(filePath) {
  const id = ++pdfIdCounter;
  pdfPathCache.set(id, filePath);
  // 清理超过 100 条的旧记录
  if (pdfPathCache.size > 100) {
    const oldest = pdfPathCache.keys().next().value;
    pdfPathCache.delete(oldest);
  }
  return id;
}

/* ─── Telegram helpers ─── */

async function sendTG(text, extra = {}) {
  try {
    const body = {
      chat_id: AUTHORIZED_CHAT_ID,
      text,
      parse_mode: 'Markdown',
      ...extra,
    };
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      // Markdown parse error → retry without parse_mode
      if (String(data.description).includes('parse')) {
        delete body.parse_mode;
        const r2 = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return r2.json();
      } else {
        console.error('[TG] sendMessage 失败:', data.description);
      }
    }
    return data;
  } catch (err) {
    console.error('[TG] 发送消息失败:', err.message);
  }
}

async function answerCallback(callbackQueryId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch (err) {
    console.error('[TG] answerCallbackQuery 失败:', err.message);
  }
}

async function getUpdates() {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`;
  const res = await fetch(url);
  const data = await res.json();
  return data.ok ? data.result : [];
}

/* ─── Paperclip helpers ─── */

async function initPaperclip() {
  if (companyId && ceoId) return;

  const companies = await fetch(`${PAPERCLIP_URL}/api/companies`).then((r) => r.json());
  if (!companies.length) throw new Error('未找到公司');

  // 在所有公司中查找 HQ-001-CEO
  for (const c of companies) {
    const agents = await fetch(`${PAPERCLIP_URL}/api/companies/${c.id}/agents`).then((r) => r.json());
    const ceo = agents.find((a) => a.name.includes('HQ-001-CEO') && a.status !== 'terminated');
    if (ceo) {
      companyId = c.id;
      ceoId = ceo.id;
      break;
    }
  }
  if (!ceoId) throw new Error('未找到 HQ-001-CEO (集团CEO) Agent');

  console.log(`[Init] 公司: ${companyId}`);
  console.log(`[Init] 集团CEO: ${ceoId}`);
}

async function createIssue(title, description) {
  const res = await fetch(`${PAPERCLIP_URL}/api/companies/${companyId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      description,
      assigneeAgentId: ceoId,
      status: 'todo',
      priority: 'high',
    }),
  });
  return res.json();
}

async function triggerHeartbeat(agentId) {
  try {
    const res = await fetch(`${PAPERCLIP_URL}/api/agents/${agentId}/heartbeat/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'telegram-bot' }),
    });
    return res.json();
  } catch (err) {
    console.error('[Heartbeat] 触发失败:', err.message);
  }
}

/* ─── 任务链路追踪 ─── */

const companyNameCache = {};

async function getCompanyName(cid) {
  if (companyNameCache[cid]) return companyNameCache[cid];
  try {
    const companies = await fetch(`${PAPERCLIP_URL}/api/companies`).then((r) => r.json());
    for (const c of companies) companyNameCache[c.id] = c.name;
    return companyNameCache[cid] || '未知';
  } catch {
    return '未知';
  }
}

async function getAgentName(agentId) {
  try {
    const a = await fetch(`${PAPERCLIP_URL}/api/agents/${agentId}`).then((r) => r.json());
    return a.name || '未知';
  } catch {
    return '未知';
  }
}

async function findChildIssues(parentIssueId, parentIdentifier, windowSec) {
  const companies = await fetch(`${PAPERCLIP_URL}/api/companies`).then((r) => r.json());
  const childIssues = [];

  for (const c of companies) {
    const issues = await fetch(`${PAPERCLIP_URL}/api/companies/${c.id}/issues`).then((r) => r.json());
    for (const issue of issues) {
      if (issue.id === parentIssueId) continue;
      const created = new Date(issue.createdAt);
      const now = new Date();
      const diffSec = (now - created) / 1000;
      if (diffSec < windowSec && issue.status !== 'cancelled') {
        const desc = issue.description || '';
        const title = issue.title || '';
        if (desc.includes(parentIdentifier) || desc.includes('董事长') || title.includes('董事长')) {
          const assigneeName = issue.assigneeAgentId ? await getAgentName(issue.assigneeAgentId) : '未分配';
          const companyName = await getCompanyName(c.id);
          childIssues.push({
            identifier: issue.identifier || issue.id.substring(0, 8),
            title: issue.title,
            assignee: assigneeName,
            company: companyName,
          });
        }
      }
    }
  }
  return childIssues;
}

async function trackTaskChain(parentIssueId, parentIdentifier) {
  // v2.1: 仅记录日志，不再推送 TG 消息（由集团 CEO Agent 自行发送任务分解消息）
  try {
    console.log(`[Chain] 等待 30s 后查询 ${parentIdentifier} 的子任务...`);
    await new Promise((r) => setTimeout(r, 30_000));

    let childIssues = await findChildIssues(parentIssueId, parentIdentifier, 120);

    if (childIssues.length === 0) {
      console.log(`[Chain] 30s 未检测到子任务，再等 30s...`);
      await new Promise((r) => setTimeout(r, 30_000));
      childIssues = await findChildIssues(parentIssueId, parentIdentifier, 180);
    }

    if (childIssues.length > 0) {
      console.log(`[Chain] 检测到 ${childIssues.length} 个子任务（不推送 TG，由 CEO 自行通知）：`);
      for (const c of childIssues) {
        console.log(`  → ${c.assignee}: ${c.title.substring(0, 50)}`);
      }
    } else {
      console.log(`[Chain] 60s 仍未检测到子任务（CEO 可能正在自行处理）`);
    }
  } catch (err) {
    console.error('[Chain] 链路追踪失败:', err.message);
  }
}

/* ─── Callback Query 处理（PDF 按钮） ─── */

async function processCallbackQuery(cbq) {
  const data = cbq.data;
  const callbackId = cbq.id;
  const chatId = String(cbq.message?.chat?.id || '');

  // 安全检查
  if (chatId !== AUTHORIZED_CHAT_ID) {
    await answerCallback(callbackId, '未授权');
    return;
  }

  // 先应答回调（消除按钮上的加载动画）
  await answerCallback(callbackId, '处理中...');

  if (data.startsWith('pdf_yes:')) {
    const relPath = data.replace('pdf_yes:', '');
    // Also check the parent message (the one above the buttons) for file tracking clues
    const parentText = cbq.message?.reply_to_message?.text || '';
    if (parentText) trackReportFile(parentText);
    let mdFilePath = resolveReportFile(relPath);
    console.log(`[PDF] resolve: ${relPath} → ${mdFilePath}`);

    if (!existsSync(mdFilePath)) {
      await sendTG('❌ 未找到报告文件，请稍后重试。');
      return;
    }

    const pdfFilePath = mdFilePath.replace('.md', '.pdf');
    console.log(`[PDF] 请求生成: ${mdFilePath}`);
    await sendTG('⏳ 正在生成 PDF，请稍候...');

    try {
      execSync(`bash /Users/hans.pan/bitworld/scripts/md-to-pdf.sh "${mdFilePath}" "${pdfFilePath}"`, {
        timeout: 30_000,
      });

      if (existsSync(pdfFilePath)) {
        execSync(
          `bash /Users/hans.pan/bitworld/scripts/telegram-send-file.sh "${pdfFilePath}" "📄 完整报告"`,
          { timeout: 30_000 }
        );
        console.log(`[PDF] 已发送: ${pdfFilePath}`);
      } else {
        await sendTG('❌ PDF 生成失败：输出文件未找到');
      }
    } catch (err) {
      console.error('[PDF] 错误:', err.message);
      await sendTG('❌ PDF 生成失败：' + err.message.substring(0, 100));
    }
  } else if (data.startsWith('email_select:')) {
    // 二级菜单：选择邮箱
    const relPath = data.replace('email_select:', '');
    const buttons = PRESET_EMAILS.map((e, idx) => ([{
      text: `📧 ${e.label}`,
      callback_data: `email_send:${idx}:${relPath}`.substring(0, 64)
    }]));
    const body = {
      chat_id: AUTHORIZED_CHAT_ID,
      text: '📧 选择收件邮箱：',
      reply_markup: { inline_keyboard: buttons }
    };
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    console.log(`[Email] 显示邮箱选择: ${relPath}`);

  } else if (data.startsWith('email_send:')) {
    // 发送邮件：email_send:index:path
    const parts = data.replace('email_send:', '').split(':');
    const emailIdx = parseInt(parts[0], 10);
    const relPath = parts.slice(1).join(':');
    const preset = PRESET_EMAILS[emailIdx];
    if (!preset) {
      await sendTG('❌ 邮箱配置无效');
      return;
    }

    const baseDir = '/Users/hans.pan/bitworld-output';
    let mdFilePath = `${baseDir}/${relPath}`;

    // 智能查找
    if (!existsSync(mdFilePath)) {
      mdFilePath = resolveReportFile(relPath);
    }

    if (!existsSync(mdFilePath)) {
      await sendTG('❌ 未找到报告文件');
      return;
    }

    await sendTG(`⏳ 正在生成 PDF 并发送至 ${preset.email}...`);

    try {
      const pdfFilePath = mdFilePath.replace('.md', '.pdf');
      // 生成 PDF
      execSync(`bash /Users/hans.pan/bitworld/scripts/md-to-pdf.sh "${mdFilePath}" "${pdfFilePath}"`, { timeout: 30_000 });

      if (!existsSync(pdfFilePath)) {
        await sendTG('❌ PDF 生成失败');
        return;
      }

      // 发送邮件
      const title = relPath.split('/').pop()?.replace('.md', '') || 'BitWorld 报告';
      const result = execSync(
        `bash /Users/hans.pan/bitworld/scripts/send-email.sh "${preset.email}" "${pdfFilePath}" "${title}"`,
        { encoding: 'utf-8', timeout: 30_000 }
      ).trim();
      console.log(`[Email] ${result}`);
      await sendTG(`✅ PDF 已发送至 ${preset.email}`);
    } catch (err) {
      console.error('[Email] 错误:', err.message);
      await sendTG('❌ 邮件发送失败：' + err.message.substring(0, 100));
    }

  } else if (data === 'no') {
    await sendTG('👌 收到，如需后续查阅可在仪表盘中查看。');
  } else {
    console.log(`[TG] 未知 callback_data: ${data}`);
  }
}

/* ─── Message processing ─── */

async function processMessage(msg) {
  const chatId = String(msg.chat.id);
  const text = msg.text?.trim();

  // 安全检查：仅处理授权用户
  if (chatId !== AUTHORIZED_CHAT_ID) {
    console.log(`[TG] 忽略非授权用户消息: chat_id=${chatId}`);
    return;
  }

  // 忽略空消息和 Bot 命令
  if (!text || text.startsWith('/')) {
    console.log(`[TG] 忽略: ${text?.substring(0, 30) || '(empty)'}`);
    return;
  }

  // 去重：防止同一条消息被处理两次
  if (processedMessages.has(msg.message_id)) {
    console.log(`[去重] 消息 ${msg.message_id} 已处理，跳过`);
    return;
  }
  processedMessages.add(msg.message_id);
  if (processedMessages.size > 100) {
    const first = processedMessages.values().next().value;
    processedMessages.delete(first);
  }

  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  console.log(`\n[TG] ⚡ ${timestamp}`);
  console.log(`[TG] 收到指令: ${text.substring(0, 80)}${text.length > 80 ? '...' : ''}`);

  // 1. 确认收到
  await sendTG('📨 收到指令，正在转达集团 CEO...');

  // 2. 确保 Paperclip 连接正常
  await initPaperclip();

  // 3. 构造事项
  const titleText = text.substring(0, 30) + (text.length > 30 ? '...' : '');
  const description = [
    `董事长通过 Telegram 下达的指令：`,
    ``,
    `> ${text}`,
    ``,
    `---`,
    ``,
    `请拆解并执行此指令。完成后：`,
    ``,
    `1. 将成果保存为 .md 文件到输出目录`,
    `2. 通过 Telegram 发送文字摘要：`,
    '```bash',
    `curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"chat_id": ${AUTHORIZED_CHAT_ID}, "text": "✅ 任务完成：xxx\\n📋 执行摘要：xxx\\n📁 产出文件：xxx.md", "parse_mode": "Markdown"}'`,
    '```',
    ``,
    `3. 紧接着发送 PDF 查阅选择按钮：`,
    '```bash',
    `curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"chat_id": ${AUTHORIZED_CHAT_ID}, "text": "📄 是否需要查阅完整报告（PDF）？", "reply_markup": {"inline_keyboard": [[{"text": "✅ 是，发送 PDF", "callback_data": "pdf_yes:日期/目录/文件名.md"}, {"text": "❌ 否，已了解", "callback_data": "no"}]]}}'`,
    '```',
    ``,
    `注意：callback_data 格式为 pdf_yes:日期/目录/文件名.md（相对于 /Users/hans.pan/bitworld-output/ 的路径），长度必须在 64 字节以内。`,
    ``,
    `所有产出文件保存到：/Users/hans.pan/bitworld-output/$(date +%Y-%m-%d)/ 对应 Agent 子目录下。`,
  ].join('\n');

  // 4. 创建事项
  const issue = await createIssue(`[董事长指令] ${titleText}`, description);
  console.log(`[TG] 事项已创建: ${issue.identifier} (${issue.id})`);

  // 5. 通知 Telegram
  await sendTG(`✅ 已创建事项 *${issue.identifier}*，CEO 正在处理...`);

  // 6. 触发 CEO Heartbeat
  const hb = await triggerHeartbeat(ceoId);
  if (hb) {
    console.log(`[TG] 集团CEO Heartbeat 已触发`);
  }

  // 7. 异步启动任务链路追踪（不阻塞主流程）
  trackTaskChain(issue.id, issue.identifier).catch((err) =>
    console.error('[Chain] 追踪异常:', err.message)
  );
}

/* ─── 自动通知：质检失败 + 执行超时 + 每日统计 ─── */

// 跟踪正在执行的 issue（用于超时检测）
const activeIssues = new Map(); // issueId → { title, agentName, startedAt }

async function checkTimeouts() {
  const now = Date.now();
  for (const [issueId, info] of activeIssues) {
    const elapsed = (now - info.startedAt) / 60_000; // minutes
    if (elapsed > 15 && !info.notified) {
      info.notified = true;
      await sendTG(
        `⏰ 执行超时 | ${info.agentName}\n` +
        `任务：${info.title}\n` +
        `已耗时：${Math.round(elapsed)} 分钟\n` +
        `状态：仍在执行中`
      );
      console.log(`[Timeout] ${info.agentName} 执行 ${info.title} 已超 15 分钟`);
    }
  }
}

async function monitorIssues() {
  try {
    await initPaperclip();
    const issues = await fetch(`${PAPERCLIP_URL}/api/companies/${companyId}/issues`).then(r => r.json());

    for (const issue of issues) {
      // Track in_progress issues for timeout detection
      if (issue.status === 'in_progress' && !activeIssues.has(issue.id)) {
        const agentName = issue.assigneeAgentId ? await getAgentName(issue.assigneeAgentId) : '未知';
        activeIssues.set(issue.id, {
          title: issue.title?.substring(0, 40) || '未知任务',
          agentName,
          startedAt: new Date(issue.startedAt || issue.updatedAt).getTime(),
          notified: false,
        });
      }

      // Clean up completed/cancelled/reset issues from tracking
      if (issue.status === 'done' || issue.status === 'cancelled' || issue.status === 'todo') {
        activeIssues.delete(issue.id);
      }

      // Track report files from completed issues' comments
      if (issue.status === 'done' && !reportFileMap.has(`tracked_${issue.id}`)) {
        try {
          const comments = await fetch(`${PAPERCLIP_URL}/api/issues/${issue.id}/comments`).then(r => r.json());
          for (const c of comments) {
            if (c.body && c.body.includes('产出文件')) {
              trackReportFile(c.body);
              reportFileMap.set(`tracked_${issue.id}`, true);
              break;
            }
          }
        } catch { /* ignore */ }
      }

      // Detect quality check failures (look for system comments with "质检未通过")
      if (issue.status === 'in_progress') {
        try {
          const comments = await fetch(`${PAPERCLIP_URL}/api/issues/${issue.id}/comments`).then(r => r.json());
          const qcFail = comments.find(c =>
            c.authorUserId === 'system' &&
            c.body?.includes('质检未通过') &&
            !qcNotified.has(c.id)
          );
          if (qcFail) {
            qcNotified.add(qcFail.id);
            const agentName = issue.assigneeAgentId ? await getAgentName(issue.assigneeAgentId) : '未知';
            const problems = qcFail.body
              .split('\n')
              .filter(l => l.startsWith('- ❌'))
              .map(l => l.trim())
              .join('\n');
            await sendTG(
              `⚠️ 质检未通过 | ${agentName}\n` +
              `任务：${issue.title?.substring(0, 40)}\n` +
              `问题：\n${problems}\n` +
              `状态：已自动退回重做`
            );
            console.log(`[QC] 质检失败通知已发送: ${issue.identifier}`);
          }
        } catch { /* ignore comment fetch errors */ }
      }
    }

    await checkTimeouts();
  } catch (err) {
    // Silently fail monitoring - don't spam logs
    if (!err.message?.includes('ECONNREFUSED')) {
      console.error('[Monitor] 监控异常:', err.message);
    }
  }
}

// Track notified quality check comments to avoid duplicates
const qcNotified = new Set();

async function getDailyStats() {
  try {
    await initPaperclip();
    const issues = await fetch(`${PAPERCLIP_URL}/api/companies/${companyId}/issues`).then(r => r.json());
    const today = new Date().toISOString().split('T')[0];

    const todayIssues = issues.filter(i => i.createdAt?.startsWith(today));
    const done = todayIssues.filter(i => i.status === 'done').length;
    const inProgress = todayIssues.filter(i => i.status === 'in_progress').length;
    const failed = todayIssues.filter(i => i.status === 'failed').length;
    const total = todayIssues.length;

    // Check quality pass rate from comments
    let qcPassed = 0, qcTotal = 0;
    for (const issue of todayIssues.filter(i => i.status === 'done')) {
      try {
        const comments = await fetch(`${PAPERCLIP_URL}/api/issues/${issue.id}/comments`).then(r => r.json());
        const hasQC = comments.some(c => c.authorUserId === 'system' && (c.body?.includes('质检通过') || c.body?.includes('质检未通过')));
        if (hasQC) {
          qcTotal++;
          if (comments.some(c => c.body?.includes('✅ 质检通过'))) qcPassed++;
        }
      } catch { /* ignore */ }
    }

    // Average completion time
    const completionTimes = todayIssues
      .filter(i => i.completedAt && i.startedAt)
      .map(i => (new Date(i.completedAt) - new Date(i.startedAt)) / 60_000);
    const avgTime = completionTimes.length > 0
      ? Math.round(completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length)
      : 0;

    const qcRate = qcTotal > 0 ? Math.round(qcPassed / qcTotal * 100) : '-';

    return `📊 今日运行统计\n` +
      `• 任务总数：${total} 个\n` +
      `• 完成：${done} | 进行中：${inProgress} | 失败：${failed}\n` +
      `• 质检通过率：${qcRate}%\n` +
      `• 平均完成时间：${avgTime || '-'} 分钟`;
  } catch {
    return '';
  }
}

/* ─── Main poll loop ─── */

async function poll() {
  try {
    const updates = await getUpdates();

    for (const update of updates) {
      lastUpdateId = update.update_id;

      if (update.message) {
        await processMessage(update.message);
      } else if (update.callback_query) {
        await processCallbackQuery(update.callback_query);
      }
    }
  } catch (err) {
    console.error('[Poll] 错误:', err.message);
    // 如果是 Paperclip 连接问题，重置缓存以便下次重连
    if (err.message.includes('fetch') || err.message.includes('ECONNREFUSED')) {
      companyId = null;
      ceoId = null;
    }
  }
}

/* ─── Startup ─── */

async function main() {
  console.log('╔═══════════════════════════════════════╗');
  console.log('║  BitWorld 董秘 Telegram Bot v2.0      ║');
  console.log('║  轮询间隔: 30s                        ║');
  console.log('║  授权用户: Hans (董事长)               ║');
  console.log('║  新增: 任务链路追踪 + PDF 按需生成     ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log('');

  // 初始化 Paperclip 连接
  try {
    await initPaperclip();
    console.log('[Start] Paperclip 连接成功');
  } catch (err) {
    console.warn('[Start] Paperclip 暂未就绪，将在收到消息时重试:', err.message);
  }

  // 清除已有消息，只处理启动后的新消息
  try {
    const existing = await getUpdates();
    if (existing.length > 0) {
      lastUpdateId = existing[existing.length - 1].update_id;
      console.log(`[Start] 跳过 ${existing.length} 条历史消息 (offset → ${lastUpdateId})`);
    }
  } catch (err) {
    console.warn('[Start] 清除历史消息失败:', err.message);
  }

  console.log('[Start] 🟢 Bot 已就绪，等待董事长指令...\n');

  // 发送上线通知
  await sendTG('🟢 BitWorld 董秘 Bot v3.0 已上线\n• 任务链路追踪\n• PDF 按需生成\n• 质检自动通知\n• 超时预警\n• 每日统计');

  // 启动轮询
  setInterval(poll, POLL_INTERVAL_MS);
  // 首次立即执行
  setTimeout(poll, 2000);

  // 启动监控（每 2 分钟检查超时和质检）
  setInterval(monitorIssues, 120_000);

  // 每日统计（每天 21:05 北京时间 = UTC 13:05，配合董秘日报）
  setInterval(async () => {
    const now = new Date();
    const bjHour = (now.getUTCHours() + 8) % 24;
    const bjMin = now.getUTCMinutes();
    if (bjHour === 21 && bjMin >= 5 && bjMin <= 7) {
      const stats = await getDailyStats();
      if (stats) await sendTG(stats);
    }
  }, 120_000);
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});
