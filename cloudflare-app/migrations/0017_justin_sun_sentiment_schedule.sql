INSERT OR REPLACE INTO scheduled_tasks (
  id,
  user_id,
  delivery_provider,
  title,
  description,
  division,
  assignee_agent_id,
  frequency,
  time_utc,
  enabled,
  priority,
  output_requirements,
  next_run_at,
  updated_at
)
SELECT
  'schedule-daily-justin-sun-sentiment-1700',
  id,
  'feishu',
  '孙宇晨与 TRON 媒体舆情日报',
  '整理截至发送时刻前48小时内，全球媒体、监管机构、TRON与HTX官方渠道及高影响力公开讨论中，与波场TRON创始人孙宇晨（Justin Sun）直接相关的报道与舆情。重点覆盖监管与法律动态、公开发言、商业与生态动作、合作与争议、媒体叙事变化、正负面舆情及其对TRON、HTX和相关品牌的潜在影响。只采用发布时间位于48小时窗口内的来源，旧报道不得作为当日事件。',
  '舆情',
  NULL,
  'daily',
  '09:00',
  1,
  'high',
  '发送简体中文核心摘要与PDF完整报告；按影响力排序整理5至10条高信号信息；每条写明媒体或发布主体、具体事件、发布时间、报道基调、舆情方向、关联影响及后续观察点；区分已核实事实、本人或官方表态、媒体评论与市场推测；合并同一事件的重复报道；参考资料只保留48小时内来源的标题、发布时间和链接；禁止输出检索状态、资料缺口、后台流程或无关的历史介绍。',
  CASE
    WHEN time('now') < '09:00:00'
      THEN strftime('%Y-%m-%dT09:00:00.000Z', 'now')
    ELSE strftime('%Y-%m-%dT09:00:00.000Z', 'now', '+1 day')
  END,
  CURRENT_TIMESTAMP
FROM users
WHERE lower(email)='hans.pan007@gmail.com'
LIMIT 1;

