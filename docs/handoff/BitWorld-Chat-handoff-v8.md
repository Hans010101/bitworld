# BitWorld Chat 接力包 v8

**日期**:2026-05-30
**核心进展**:Phase 7 知识库复用 + Hotfix-v20/v21 飞书自助开通(口令+申请+欢迎语)+ 飞书企业认证待办

---

## § 0 必读 — Chat 行为规则(继承 v7 § 0,本版强化)

继承 v7 § 0.1–0.16 全部。本版新增:

### 0.17 schema 假设纪律(BW-127)
- Chat 出涉及 DB schema/字段名的长指令,无实测副本时,伪代码字段名必须标"待 audit 确认,Code 以实测为准",不写成确定事实
- 本项目已多次用错 schema 假设(Hotfix-v8 英文路径 / Phase6 metadata / Phase7 issues.content / v20 sendTextMessage 签名)

### 0.18 平台前置确认(本版新增)
- 涉及第三方平台(飞书/TG/微信)的功能,Chat 必须在 Phase 开始就确认平台前置(可见范围/认证/成员归属),不能只做代码层把平台层留到最后才暴露
- 教训来源:Phase 6 做完整套 SaaS 化代码,最后才发现飞书 Bot 可见范围没开 + 企业未认证 + 董事是否在组织内未确认

### 0.19 任务清单做减法(本版新增)
- Hans 问"有哪些工作"时,先推 2-3 个最该做的,完整清单折叠附后,不平铺十几项让 Hans 自己挑

---

## § 1 项目状态快照(2026-05-30)

### 1.1 GitHub / Cloud Run

| 维度 | 状态 |
|---|---|
| master HEAD | 4e01bf2 / 4e01bf2c2e9de59e6173a6ef277b0585dbb289b2 |
| Cloud Run | strict 模式,FEISHU_JOIN_PASSCODE 待 Hans 配 |
| BW-95 累计 auto-merge | 12+ 次全绿 |

### 1.2 Phase 7 + Hotfix-v20/v21

| 版本 | commit | PR | 功能 |
|---|---|---|---|
| Phase 7 | 3f73379 | #20 | 知识库复用:同事业部同类型近7天报告摘要注入 prompt(省 token)|
| Hotfix-v20 | 1d2c4bc | #21 | 自助开通:口令(FEISHU_JOIN_PASSCODE)+ 申请批准(notify admin 私聊)+ migration 0038 join_requests 表 |
| Hotfix-v21 | 236aad3 | #22 | 非白名单欢迎引导语(欢迎+能力简述+口令提示+申请确认三合一) |

### 1.3 知识库复用机制(Phase 7)

- 报告体在 issue_comments.body(非 issues.content)
- 类型签名:title 去日期(NEWS_CEO 产 4 类型,CRYPTO_CEO 2 类型,需签名区分)
- 注入点:heartbeat.ts:2002 区域,context.kbReuseSummaries
- 开关:env KB_REUSE_ENABLED(默认开)
- fail-safe:查不到/出错返回空,不阻断报告
- 验证:需库里有 7 天内同签名 done 报告;首日空不注入,次日起生效;抓 log 搜 `[kb-reuse] injected`

### 1.4 飞书自助开通运营手册

- **口令自助**:Hans 配 env FEISHU_JOIN_PASSCODE=xxx → 发口令给可信圈 → 他们加 Bot 发口令(当普通消息发)→ 自动入白名单
- **申请批准**:非口令消息 → 自动建 join_request + DM 第一个 admin(带 /admin add 一键命令)→ Hans 点/复制批准
- **欢迎语**:非白名单首发自动收欢迎引导(v21)
- **测试前提**:必须用非白名单号测(Hans 自己在白名单,发口令不触发自助)

---

## § 2 🔴 飞书平台层待办(阻塞外部使用)

**当前状态**:飞书企业**未认证** + Bot 可见范围可能只含 Hans + 董事是否在组织内未确认。

**这是外部董事使用的真正阻塞点**,代码层(口令/申请/并联)全做好了但平台层没通。

| 待办 | 操作 | 状态 |
|---|---|---|
| 企业认证 | feishu.cn/admin → 企业认证(需营业执照,审核 1-2 工作日) | Hans 进行中 |
| 可用范围 | 开发者后台 → 版本管理 → 创建版本 → 可用范围设全员/加董事 → 发布 | 认证后做 |
| webhook 地址 | 事件与回调 → 确认指向 Cloud Run | 待确认 |
| 消息权限 | 权限管理 → 接收/发送消息已开 | 待确认 |

**App 信息**:名「Bitworld 董秘」,App ID `<FEISHU_APP_ID>`,组织=用户536225的组织。

**认证慢的备选**:接 Telegram 外部渠道(0 认证,后端逻辑复用)。

---

## § 3 BW-127(本版新增,累计 27 条核心铁律)

| 编号 | 教训 |
|---|---|
| BW-127 | schema/字段名长指令无实测副本时,伪代码标"待 audit 确认",不当确定事实 |

(BW-100~126 见接力包 v7 § 3)

---

## § 4 P2 任务池(分类)

### 收尾
- ✅ 接力包 v8 归档(本批)

### 待修小项
| 项 | 工作量 |
|---|---|
| admin self-protect(防误 suspend 自己/其他 admin) | 低 |
| v13 UI 多租户下拉(server 就绪,缺 React 接线,需 Hans 飞书测) | 中 |
| PDF visual bold(注册 NotoSansCJK-Bold) | 低 |
| Phase 7 效果验证(明早抓 log 看 token 降幅) | 观察 |

### 新功能
| 项 | 价值 | 工作量 |
|---|---|---|
| Telegram 外部渠道(绕开飞书认证) | 高(认证慢时备选) | 中 |
| 跨事业部协作 | 高 | 高 |
| 知识库复用增强(向量检索 + token 度量) | 中高 | 中高 |
| Agent 绩效评分 | 低 | 低 |
| 邮件 SMTP 发送 | 中 | 低 |

### 基础设施
| 项 | 说明 | 工作量 |
|---|---|---|
| BW-79 GitHub Actions 诊断激活 | Code 自主看 Cloud Run logs,免 Hans 截图 | 30 min |
| agent→报告类型映射表 | 补进接力包防 schema 误判 | 5 min |

---

## § 5 关键文件/凭证

继承 v7 § 6。Phase 7 + v20/v21 新增:
- server/src/services/kb-reuse.ts(Phase 7)
- server/src/services/feishu-onboarding.ts(v20)
- server/src/services/feishu-bot.ts +sendDirectMessageToOpenId(v20)
- packages/db migrations 0038 + feishu_join_requests 表
- env 待配:FEISHU_JOIN_PASSCODE

---

## § 6 红线

继承 v7 § 7 + Phase 7/v20/v21 代码不破坏。

---

## § 7 Day 1 操作清单(新 Chat 启动)

### 7.1 开场白模板

> 接力包 v8 已收到。Phase 7 知识库复用 + 飞书自助开通(v20/v21)完成。飞书企业认证进行中(阻塞外部使用)。严守接力包 § 0 行为规则(含 0.17 schema 纪律 / 0.18 平台前置 / 0.19 任务做减法)。
> [Hans 下一句]

### 7.2 待办(Hans 决定时机)
- 飞书企业认证通过后配可用范围
- 待修小项:admin self-protect / PDF visual bold(可合一个 Hotfix)
- BW-79 激活
- Phase 7 效果验证(明早)
