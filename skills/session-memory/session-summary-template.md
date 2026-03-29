---
name: session-summary
description: Agent 每次完成任务后自动生成会话摘要的模板。所有 Agent 在任务结束时激活，用于跨会话持久化上下文。
auto_invoke: true
---

# 会话摘要模板

## 使用方法

每次 Agent 完成一个 Issue/Ticket 后，必须在产出末尾附加以下结构化摘要，用于存入数据库，下次唤醒时注入上下文。

## 摘要格式

```yaml
session_summary:
  agent: [Agent 编号，如 News-001-CEO]
  date: [日期时间 ISO 格式]
  task_type: [早报/晚报/临时指令/周报]
  task_id: [Issue/Ticket ID]

  # 本次完成了什么
  completed:
    - [完成事项 1]
    - [完成事项 2]

  # 发现了什么（供下次参考的经验/发现）
  discoveries:
    - [发现 1：例如"某数据源 API 响应变慢，建议下次用备选源"]
    - [发现 2：例如"BTC 与纳指相关性近期升至 0.85，值得持续跟踪"]

  # 下次应关注什么
  next_attention:
    - [关注项 1：例如"明日 20:30 美国 CPI 数据发布"]
    - [关注项 2：例如"ETH Dencun 升级后 L2 费用数据需持续采集"]

  # 本次遇到的问题
  issues:
    - [问题 1：例如"Glassnode 免费 API 达到日限额，部分链上数据缺失"]

  # 质量自评（1-10 分）
  quality_score: [数字]
  quality_note: [简短说明]
```

## 会话记忆注入规则

当 Agent 被 Heartbeat 唤醒执行新任务时：

1. 查询该 Agent 最近 3 次的 session_summary
2. 将它们作为"历史上下文"注入到 Agent 的 system prompt 中
3. 注入格式：

```
## 近期工作记忆
### [日期1] - [任务类型]
- 完成: ...
- 发现: ...
- 下次关注: ...

### [日期2] - [任务类型]
...
```
