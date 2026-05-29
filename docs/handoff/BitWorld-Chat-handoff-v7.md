# BitWorld Chat 接力包 v7

**日期**:2026-05-15
**核心进展**:Phase 6 飞书 Bot SaaS 化完整收官(v10-v14 五个 Hotfix)+ BW-100~126 共 27 条新铁律 + 下个 Phase 7 = 知识库复用

---

## § 0 必读 — Chat 行为规则(继承 v6 § 0,本版强化)

继承 v6 § 0.1–0.12 全部。本版新增:

### 0.13 简洁纪律(BW-121/122/126)
- Hans 说"啰嗦"后,下轮回复 < 上轮 50% 字数
- 回复正文 ≤ 8 行(不含挑你/挑自己)
- 简洁 ≠ 省关键信息:命名/备注/不可逆操作必须说明"长期影响"
- 步骤指引给直接链接 + 按钮文案,不引用历史截图,不假设浏览器状态

### 0.14 部署链与诊断(BW-123/124)
- 让 Hans 抓日志时给"新旧 revision 输出格式对比"
- 接力包 P2 基础设施待办(如 BW-79),相关场景出现时 Chat 主动重提

### 0.15 沙箱限制(BW-119)
- 长指令禁用 sleep/cron/nohup/curl 外网(沙箱 block)
- 用 fetch + 检测 / Monitor pattern

### 0.16 大架构上线运营手册(本版新增)
- 大架构上线时,Chat 主动给"日常运营操作手册"(加新人/暂停/看用量),不等 Hans 问

---

## § 1 项目状态快照(2026-05-15,Phase 6 收官)

### 1.1 GitHub / Cloud Run

| 维度 | 状态 |
|---|---|
| master HEAD | 119cff2 / 119cff24d001ea5228f31a248b83fb2af8ea7bb1 |
| Cloud Run revision | bitworld-00064-lzm(strict 模式,19 个 env) |
| Cloud Run env 总数 | 19(含 4 个 Phase 6 新增:WHITELIST/ADMIN/MONTHLY_BUDGET/DAILY_LIMIT) |
| BW-95 累计 auto-merge | 9 次全绿 |

### 1.2 Phase 6 五个 Hotfix(全部 merged)

| 版本 | commit | PR | 功能 |
|---|---|---|---|
| v10 | ededcff | #14 | 回复发送方原 chat,不硬编码 FEISHU_CHAT_ID |
| v11 | 8c4c7b3 | #15 | env sender 白名单 ACL |
| v12 | c0360e4 | #16 | per-sender 配额 + migration 0036 |
| v13 | c47ddb4 | #17 | server `?senderOpenId=` 多租户过滤 |
| v14 | 119cff2 | #18 | /admin 命令 + DB ACL 3 表 + migration 0037 |

### 1.3 飞书 Bot SaaS 化运营手册(日常操作)

**加新董事**:
1. 董事加 Bot 发"hi"
2. Hans 看 Cloud Run logs 搜 `Feishu] received message` → 复制 senderOpenId
3. Hans 飞书发 `/admin add ou_xxx 真名`(备注填真名,非"自己")
4. 该董事立即可用,无需 redeploy

**其他 admin 指令**:`/admin remove/list/suspend <id> <天数>/unsuspend/help`

**配额**:全池月 2000 命令 + 单人日 50 命令,改 env redeploy 调整

**当前白名单**:Hans 自己(ou_c3f7880a870cb0ded0ca8892037e431b)

---

## § 2 Phase 6 架构(SaaS 化 5 层)

webhook 入口解析 sender → /admin 分支(admin 指令)→ 白名单 ACL(DB-first env-fallback)→ 配额检查 → issue 创建(metadata 存 sender)→ 执行 → sendNotification 按 metadata.feishuChatId 回发原 sender。

DB 表:feishu_quota_usage(0036)+ feishu_whitelist/feishu_admins/feishu_suspensions(0037)。

---

## § 3 本日新沉淀 BW 铁律(BW-100~126,共 27 条)

| 编号 | 教训(一句话) |
|---|---|
| BW-100 | 接力包开场先 view 原文,不基于转述确认 |
| BW-101 | 区分 verify ask(核对)vs real gap(警告) |
| BW-102 | 门槛任务单列优先,不与扩展任务三选一 |
| BW-103 | 引用代码设计点说清作用域,不笼统说"兜底" |
| BW-104 | 估时含等待+确认+反馈循环成本(占 60-80%) |
| BW-105 | 截图推断标注"推断",不当事实 |
| BW-106 | 多确认问题统一 (a)/(b)/(c) 格式 |
| BW-107 | 需求探索用自由叙述,不先 a/b/c |
| BW-108 | 长指令含路径/字段前先 audit 实测 |
| BW-109 | § 5 预授权 audit 推翻预设后的扩展 |
| BW-110 | Code 视角完工 ≠ 部署完成 |
| BW-111 | PDF 时间戳 vs Hotfix push 时间先对比 |
| BW-112 | PDF/canvas cursor reset 责任显式标 |
| BW-113 | 归档文档链末状态待 verify/留空 |
| BW-114 | 占位符未替换 → fail 不 push |
| BW-115 | Phase 级任务先 1 轮自由叙述场景再决策按钮 |
| BW-116 | 新铁律沉淀后下次 hard-apply,不"知道但忘用" |
| BW-117 | 风险高选项 Hans 已知接受才执行,先 push back |
| BW-118 | 长指令行数与预期偏差大必须说明原因 |
| BW-119 | 长指令禁 sleep/cron/curl 外网 |
| BW-120 | Hans 操作清单标时机 BEFORE/PARALLEL/AFTER |
| BW-121 | Hans 说啰嗦后回复 <50% 字数 |
| BW-122 | 回复 ≤8 行;不假设浏览器状态;给直接链接 |
| BW-123 | 抓日志给新旧格式对比 |
| BW-124 | P2 基础设施待办相关场景主动重提 |
| BW-125 | 推 P2 算累计成本 vs 一次性成本 |
| BW-126 | 简洁≠省关键信息(命名/不可逆操作说明长期影响) |

---

## § 4 BW-95 实战(本日累计 9 次全绿)

self-install(v7)+ Phase5b(v8/v9/v9.1)+ handoff-v6 + Phase6(v10-v14)= 9 次,Hans 0 PR merge。

---

## § 5 下个 Phase 7 = 知识库复用(已定)

**目标**:历史报告作为新任务参考,减少重复采集,省 DeepSeek token 30-50% + 报告连贯性提升。

**待场景化询问**(Phase 7 启动时 Chat 先问):
- 复用粒度:同事业部同类型报告?跨事业部?
- 复用窗口:近 N 天?
- 注入方式:全文注入 prompt?摘要注入?向量检索?
- 存储:复用现有 Supabase?新增 embedding 表?

**P2 任务池(Phase 7 后续/并行)**:
| 项 | 复杂度 |
|---|---|
| Hotfix admin self-protect(不能 suspend 自己/其他 admin) | 低 |
| Hotfix v13 UI 多租户下拉(React 接线,需 Hans 飞书测) | 中 |
| Hotfix visual bold(NotoSansCJK-Bold face 注册) | 低 |
| BW-79 GitHub Actions 诊断激活(30 min,Code 自主看 logs) | 中 |
| 跨事业部协作 / Agent 绩效评分 / TG 端到端 / 邮件 SMTP | 中 |

---

## § 6 关键文件/凭证

继承 v5 § 6 + v6 § 6。Phase 6 新增:
- `server/src/services/feishu-admin.ts` / `feishu-whitelist.ts` / `feishu-quota.ts`
- `packages/db/src/schema/feishu_acl.ts` / migrations 0036+0037
- Cloud Run env 19 个(4 个 FEISHU_* SaaS 化变量)

---

## § 7 红线

继承 v5 § 7 + Phase 6 已实施代码(feishu webhook 入口/whitelist/quota/admin/migration 0036+0037)不破坏。

---

## § 8 Day 1 操作清单(新 Chat 启动)

### 8.1 开场白模板

> 接力包 v7 已收到。Phase 6 飞书 Bot SaaS 化收官,BW-95 实战 9 次全绿。下个 Phase 7 = 知识库复用。严守接力包 § 0 行为规则(含 0.13 简洁纪律 / 0.16 运营手册)。
> [Hans 下一句:Phase 7 知识库复用 / 或 P2 任意项 / 或 smoke test]

### 8.2 待办(Hans 决定时机)
- 生产 smoke test(/admin 全指令验证)
- BW-79 激活(Code 自主诊断)
- Phase 7 知识库复用启动
