# BitWorld Chat 接力包 v9

**日期**:2026-05-30
**核心进展**:Cloud Run 成本优化(方案 C 切换完成)+ 修复 6 层从未在生产跑通的 bug + 意外挖出并修复"定时报告投递一直断裂"的长期 bug

---

## § 0 必读 — Chat 行为规则(继承 v8 § 0,本版强化)

继承 v8 § 0.1–0.19 全部。本版新增:

### 0.20 生产交付必须端到端真验证(BW-128)
- 任何涉及生产部署的"已完成"交付,上线前必须有一次端到端、到**最终用户可见结果**的真实验证
- status:done / HTTP 200 / typecheck 绿 / log 漂亮 **都不算数** —— 它们只证明"代码自认为跑完了",不证明用户真收到
- 验收标准必须落到业务结果(飞书真收到报告 + PDF 能打开),不能停在技术指标

### 0.21 多窗口指挥的方向一致性(BW-129)
- 多个对话窗口指挥同一项目时,最危险的不是某窗口出错,是两窗口各自正确但方向冲突(本线 min=0 vs min=1 反复纠正 4 次)
- 接手他窗口交付物时,关键约束(如 min=1)必须在每份交接物最显眼处重复钉死,不假设"说过一次就记住"
- 跨窗口调研结论不会自动知道你最新的架构变更(那个成本调研漏算了飞书实时 webhook 需常驻)

### 0.22 优化前先验证被优化对象真能工作(BW-130)
- 接手任何"优化/降本"任务前,先验证"被优化的东西当前真的 work"
- 本线惨痛教训:全程假设系统在正常运行只是费钱,实测发现任务触发坏的(404/agentId)+ 报告投递也坏的(not_hq_ceo),系统"正常运行"是幻觉

---

## § 1 成本优化最终状态(2026-05-30 完成)

### 1.1 方案 C 切换完成

| 配置 | 值 | 作用 |
|---|---|---|
| min-instances | **1**(🔴 非 0)| 飞书 webhook 实时,不冷启动 |
| cpu-throttling | true | 空闲不计费 CPU(省钱主力)|
| max-instances | 3 | 限制并发上限 |
| timeout | 900s | 容纳最长任务 |
| USE_INTERNAL_CRON | false | 关内部 cron,避免双触发 |

- 月成本:~$41 → ~$8-15
- 当前生产 revision(切换后):bitworld-00081-pq8
- 回滚锚点:bitworld-00080-k95(投递验证正常的版本)

### 1.2 13 个 GCP Scheduler job(全 ENABLED)

| task | cron(Asia/Shanghai) | agent name |
|---|---|---|
| news-morning | 0 8 * * * | News-001-CEO |
| tech-morning | 5 8 * * * | News-001-CEO |
| crypto-morning | 10 8 * * * | Crypto-001-CEO |
| justin-sentiment | 0 19 * * * | Sentiment-001-CEO |
| news-evening | 0 21 * * * | News-001-CEO |
| tech-evening | 5 21 * * * | News-001-CEO |
| crypto-evening | 10 21 * * * | Crypto-001-CEO |
| secretary | 15 21 * * * | HQ-003-董秘 |
| sentiment-weekly | 0 9 * * 1 | Sentiment-001-CEO |
| research-weekly | 30 9 * * 1 | Research-001-CEO |
| github-ai-weekly | 0 17 * * 5 | News-001-CEO |
| cho-weekly | 15 17 * * 5 | HQ-004-CHO |
| cfo-weekly | 30 17 * * 5 | HQ-005-CFO |

- 每个 job:`--attempt-deadline=900s --max-retry-attempts=0`(发消息不幂等,宁漏不重发)
- header:`X-Trigger-Token: <TRIGGER_SECRET>`
- 实测耗时:secretary 2.5-29s / news-evening 27s / research-weekly 89s —— **全 <14min,无需 Cloud Run Job**

### 1.3 验证记录

- 手动 curl:secretary / news-evening / research-weekly 全 200 + 飞书真收到 + PDF 正常
- **自动触发**:19:00 justin-sentiment 自动跑通,飞书收到(第一个真·自动样本)
- 待观察:今晚 21:00 晚报四连(同路径,大概率正常)+ 第一个周五 17:30 cfo-weekly 盯 504

---

## § 2 今天修复的 6 层 bug(/jobs/run 从未在生产跑通)

那个对话交付的整套 /jobs/run 成本改造**从未在生产 200 过**,靠 Hans 在 Cloud Shell 逐层实测剥出:

| # | 层 | 问题 | 修复 | commit |
|---|---|---|---|---|
| 1 | hostname | 7zi URL 被 Paperclip 白名单 403 | 改用 568 URL(飞书在用、已在白名单)| 配置 |
| 2 | TRIGGER_SECRET | 没配 → 503 | openssl rand 生成并配 env | 配置 |
| 3 | timeout | Cloud Run 默认 300s(非清单写的 900)| --timeout=900 | 配置 |
| 4 | 404 自调 | /jobs/run 调 /api/agents/:id/heartbeat/invoke HTTP 自调,无 auth header 被拦 | 改进程内直调(executeTaskDirect),内部 cron 也一起切 | 3d7a549 |
| 5 | agentId | 硬编码 dev-DB UUID(44115df3...)在生产不存在 | 运行时按 agents.name 查(权威源 admin-seed.ts)+ companyId 也动态查 | 59ed96b |
| 6 | 投递 gate | not_hq_ceo + no_feishu_source 双 gate 砍掉所有事业部 CEO 报告 | role 白名单(ceo/division_ceo/secretary/cho/cfo)+ env FEISHU_CHAT_ID 兜底 | 2559d4d |

**真实 URL 权威源**:飞书开发者后台 webhook 回调 = `https://bitworld-568423242189.asia-northeast1.run.app/api/feishu/webhook`。这是唯一被生产验证能通过 Paperclip 白名单的地址。

---

## § 3 最大发现:定时报告投递一直是断的

- bug 6(not_hq_ceo gate)是长期存在的:gate 硬编码只放行 HQ CEO 的 issue,事业部 CEO 的定时报告(早晚报/舆情/周报)**从来没推送到飞书过**
- Hans 确认:平时定时报告一直收不到飞书
- 含义:系统"看起来在跑"(有心跳、status done)但端到端投递断裂。省成本是次要,**让核心功能真正工作起来才是今天真正价值**
- gate 位置:`openai-post-run.ts:545-606`(Phase 5b 文件内,但与渲染管道 267-456 分离,本次只动 gate 未碰渲染)

---

## § 4 BW-128/129/130(本版新增,累计 30 条核心铁律)

| 编号 | 教训 |
|---|---|
| BW-128 | 生产交付上线前必须端到端验证到用户可见结果;status/200/typecheck/log 都不算数 |
| BW-129 | 多窗口指挥同项目,关键约束每份交接物最显眼处重复钉死;跨窗口调研不知你最新架构 |
| BW-130 | 接手优化/降本任务前,先验证被优化对象当前真能端到端工作 |

(BW-100~127 见接力包 v7/v8 § 3)

---

## § 5 待办池

### 成本线收尾观察(被动)
- 今晚 21:00 晚报四连确认各一份
- 第一个周五 17:30 cfo-weekly 盯 504(若超 14min 才需建 Cloud Run Job)
- 切换后看 Cloud Run CPU 计费降幅确认省钱到位

### 已知潜在坑(下一个值得统一)
- feishu-webhook 找 agent 用 env TG_HQ_CEO_ID + 硬编码兜底,与刚修的 scheduler name 查不一致 —— 是下一个潜在坑,成本线收尾后值得统一
- Phase 7 kb-reuse 的 getRecentSimilarSummaries 也应确认未用错 agentId 空转

### 多项目降本(Hans 另一对话在推,本窗口暂不碰)
- midas-prod / gen-lang-client-* 等项目费用未查清
- 删 Cloud Run 不可逆,需先扫描列清单再删,勿疲劳操作

### 飞书产品化(认证放弃后)
- 走邀请模式:Hans 在 feishu.cn/admin 生成邀请链接发董事加入组织 → 现有口令/申请方案直接用
- 未认证组织邀请有人数上限(~20)
- 后续 Telegram 外部渠道(0 认证)备选

### 其他待修小项(继承 v8)
- admin self-protect / v13 UI 多租户下拉 / PDF visual bold / BW-79 GitHub Actions 诊断激活

---

## § 6 关键基础设施(更新)

- GitHub:Hans010101/bitworld(master);BW-95 auto-pr-merge 生效
- Cloud Run:project bitworld-491702,region asia-northeast1,服务 bitworld
- 真实 URL:https://bitworld-568423242189.asia-northeast1.run.app(飞书在用 + 白名单内)
- TRIGGER_SECRET:已配 Cloud Run env(/jobs/run 鉴权,X-Trigger-Token header)
- FEISHU_CHAT_ID:已配(定时报告投递兜底目标,***REMOVED_FROM_PUBLIC_HISTORY***)
- DB:Supabase(fjnoojonutnfpvhjxmhp);AI:DashScope/DeepSeek
- 本地:/Users/hans.pan/bitworld(改);/Users/hans.pan/paperclip(永不碰)
- master HEAD(本归档时):bb058da / bb058da94de0e93e93e90ee2c12c8730e3c3163a

---

## § 7 红线

继承 v8 § 6 + 成本优化相关:
- 🔴 min-instances=1 永远非 0(飞书实时刚需)
- 🔴 不擅改 Cloud Run 部署配置(Hans 手动 gcloud)
- 🔴 13 Scheduler 的 --max-retry-attempts=0 不改(防重发)

---

## § 8 Day 1 操作清单(新 Chat 启动)

### 8.1 开场白模板

> 接力包 v9 已收到。成本优化方案 C 切换完成(min=1 + throttling + Scheduler,月 $41→$8-15)。今天修了 6 层 /jobs/run bug + 意外修复"定时报告投递一直断裂"的长期 bug。19:00 自动触发已验证。严守接力包 § 0 行为规则(含 0.20 端到端验证 / 0.21 多窗口一致性 / 0.22 优化前验证)。
> [Hans 下一句]

### 8.2 待办(Hans 决定时机)
- 成本线被动观察(今晚晚报 + 首个周五 cfo-weekly)
- feishu-webhook agent 查法与 scheduler 统一(潜在坑)
- 飞书邀请模式上线(认证放弃后)
- 待修小项合并 Hotfix
