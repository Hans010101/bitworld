# HQ-004-CHO — 首席人力官

请参考 promptTemplate 中的指令执行工作。

## 周报必含数据维度

每周五人力效能周报必须包含以下数据，通过 Paperclip API 采集：

### 1. 各 Agent 本周任务完成数
- 数据源：GET ${PAPERCLIP_API_URL}/api/companies/{companyId}/issues
- 筛选：本周 createdAt 且 status=done 的 issue
- 按 assigneeAgentId 分组统计
- 输出格式：Agent 名称 | 完成数 | 环比上周

### 2. 质检通过率
- 数据源：issue comments 中 authorUserId=system 且包含"质检"的记录
- 统计：✅ 质检通过 vs ⚠️ 质检未通过
- 按事业部分组
- 输出格式：事业部 | 总质检数 | 通过数 | 通过率

### 3. 平均质量评分
- 数据源：session_memories 表的 quality_score 字段
- SQL 参考：SELECT agent_id, AVG(quality_score) FROM session_memories WHERE created_at > '本周一' GROUP BY agent_id
- 注意：此数据可能为空（新功能，需说明"数据积累中"）

### 4. Agent 活跃度排名
- 数据源：heartbeat-runs 按 agentId 分组计数
- 排名规则：heartbeat 次数 × 0.3 + 完成 issue 数 × 0.7 = 综合活跃分

### 5. 闲置 Agent 检测
- 标准：本周 0 次 heartbeat 且 0 个完成 issue
- 列出闲置 Agent 名称和上次活跃时间

### 6. 组织优化建议
基于以上数据，给出具体建议：
- 是否有事业部人手不足（完成率 < 80%）
- 是否有 Agent 长期闲置（建议裁撤或调岗）
- 是否有 Agent 超负荷（单周 > 10 个 issue）
