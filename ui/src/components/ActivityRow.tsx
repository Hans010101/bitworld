import { Link } from "@/lib/router";
import { Identity } from "./Identity";
import { timeAgo } from "../lib/timeAgo";
import { cn } from "../lib/utils";
import { deriveProjectUrlKey, type ActivityEvent, type Agent } from "@paperclipai/shared";

const ACTION_VERBS: Record<string, string> = {
  "issue.created": "创建了",
  "issue.updated": "更新了",
  "issue.checked_out": "检出了",
  "issue.released": "释放了",
  "issue.comment_added": "评论了",
  "issue.attachment_added": "添加了附件到",
  "issue.attachment_removed": "移除了附件从",
  "issue.document_created": "创建了文档于",
  "issue.document_updated": "更新了文档于",
  "issue.document_deleted": "删除了文档从",
  "issue.commented": "评论了",
  "issue.deleted": "删除了",
  "agent.created": "创建了",
  "agent.updated": "更新了",
  "agent.paused": "暂停了",
  "agent.resumed": "恢复了",
  "agent.terminated": "终止了",
  "agent.key_created": "创建了 API 密钥于",
  "agent.budget_updated": "更新了预算于",
  "agent.runtime_session_reset": "重置了会话于",
  "heartbeat.invoked": "触发了心跳于",
  "heartbeat.cancelled": "取消了心跳于",
  "approval.created": "请求了审批",
  "approval.approved": "批准了",
  "approval.rejected": "拒绝了",
  "project.created": "创建了",
  "project.updated": "更新了",
  "project.deleted": "删除了",
  "goal.created": "创建了",
  "goal.updated": "更新了",
  "goal.deleted": "删除了",
  "cost.reported": "报告了成本于",
  "cost.recorded": "记录了成本于",
  "company.created": "创建了公司",
  "company.updated": "更新了公司",
  "company.archived": "归档了",
  "company.budget_updated": "更新了预算于",
};

const STATUS_ZH: Record<string, string> = {
  todo: "待处理", in_progress: "进行中", in_review: "审核中", done: "已完成",
  blocked: "已阻塞", cancelled: "已取消", backlog: "待办",
};
const PRIORITY_ZH: Record<string, string> = {
  critical: "紧急", high: "高", medium: "中", low: "低",
};

function humanizeValue(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "无");
  return STATUS_ZH[value] ?? PRIORITY_ZH[value] ?? value.replace(/_/g, " ");
}

function formatVerb(action: string, details?: Record<string, unknown> | null): string {
  if (action === "issue.updated" && details) {
    const previous = (details._previous ?? {}) as Record<string, unknown>;
    if (details.status !== undefined) {
      const from = previous.status;
      return from
        ? `将状态从 ${humanizeValue(from)} 改为 ${humanizeValue(details.status)} 于`
        : `将状态改为 ${humanizeValue(details.status)} 于`;
    }
    if (details.priority !== undefined) {
      const from = previous.priority;
      return from
        ? `将优先级从 ${humanizeValue(from)} 改为 ${humanizeValue(details.priority)} 于`
        : `将优先级改为 ${humanizeValue(details.priority)} 于`;
    }
  }
  return ACTION_VERBS[action] ?? action.replace(/[._]/g, " ");
}

function entityLink(entityType: string, entityId: string, name?: string | null): string | null {
  switch (entityType) {
    case "issue": return `/issues/${name ?? entityId}`;
    case "agent": return `/agents/${entityId}`;
    case "project": return `/projects/${deriveProjectUrlKey(name, entityId)}`;
    case "goal": return `/goals/${entityId}`;
    case "approval": return `/approvals/${entityId}`;
    default: return null;
  }
}

interface ActivityRowProps {
  event: ActivityEvent;
  agentMap: Map<string, Agent>;
  entityNameMap: Map<string, string>;
  entityTitleMap?: Map<string, string>;
  className?: string;
}

export function ActivityRow({ event, agentMap, entityNameMap, entityTitleMap, className }: ActivityRowProps) {
  const verb = formatVerb(event.action, event.details);

  const isHeartbeatEvent = event.entityType === "heartbeat_run";
  const heartbeatAgentId = isHeartbeatEvent
    ? (event.details as Record<string, unknown> | null)?.agentId as string | undefined
    : undefined;

  const name = isHeartbeatEvent
    ? (heartbeatAgentId ? entityNameMap.get(`agent:${heartbeatAgentId}`) : null)
    : entityNameMap.get(`${event.entityType}:${event.entityId}`);

  const entityTitle = entityTitleMap?.get(`${event.entityType}:${event.entityId}`);

  const link = isHeartbeatEvent && heartbeatAgentId
    ? `/agents/${heartbeatAgentId}/runs/${event.entityId}`
    : entityLink(event.entityType, event.entityId, name);

  const actor = event.actorType === "agent" ? agentMap.get(event.actorId) : null;
  const actorName = actor?.name ?? (event.actorType === "system" ? "系统" : event.actorType === "user" ? "管理员" : event.actorId || "未知");

  const inner = (
    <div className="flex gap-3">
      <p className="flex-1 min-w-0 truncate">
        <Identity
          name={actorName}
          size="xs"
          className="align-baseline"
        />
        <span className="text-muted-foreground ml-1">{verb} </span>
        {name && <span className="font-medium">{name}</span>}
        {entityTitle && <span className="text-muted-foreground ml-1">— {entityTitle}</span>}
      </p>
      <span className="text-xs text-muted-foreground shrink-0 pt-0.5">{timeAgo(event.createdAt)}</span>
    </div>
  );

  const classes = cn(
    "px-4 py-2 text-sm",
    link && "cursor-pointer hover:bg-accent/50 transition-colors",
    className,
  );

  if (link) {
    return (
      <Link to={link} className={cn(classes, "no-underline text-inherit block")}>
        {inner}
      </Link>
    );
  }

  return (
    <div className={classes}>
      {inner}
    </div>
  );
}
