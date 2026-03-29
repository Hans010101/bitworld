import { useMemo, useState } from "react";
import { NavLink, useLocation } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useSidebar } from "../context/SidebarContext";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { cn, agentRouteRef, agentUrl } from "../lib/utils";
import { AgentIcon } from "./AgentIconPicker";
import { BudgetSidebarMarker } from "./BudgetSidebarMarker";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Agent } from "@paperclipai/shared";

const GROUP_CONFIG: { prefix: string; label: string }[] = [
  { prefix: "HQ-", label: "总部" },
  { prefix: "Research-", label: "市场研究" },
  { prefix: "Sentiment-", label: "舆情应对" },
  { prefix: "Crypto-", label: "加密交易" },
  { prefix: "News-", label: "新闻雷达" },
];

interface AgentGroup {
  label: string;
  agents: Agent[];
}

function groupAgents(agents: Agent[]): AgentGroup[] {
  const buckets = new Map<string, Agent[]>();
  for (const g of GROUP_CONFIG) buckets.set(g.prefix, []);
  buckets.set("_other", []);

  for (const a of agents) {
    const match = GROUP_CONFIG.find((g) => a.name.startsWith(g.prefix));
    const key = match ? match.prefix : "_other";
    buckets.get(key)!.push(a);
  }

  // Within each group, CEO (-001-) first, then alphabetical
  for (const list of buckets.values()) {
    list.sort((a, b) => {
      const aIsCeo = a.name.includes("-001-") ? 0 : 1;
      const bIsCeo = b.name.includes("-001-") ? 0 : 1;
      if (aIsCeo !== bIsCeo) return aIsCeo - bIsCeo;
      return a.name.localeCompare(b.name);
    });
  }

  const groups: AgentGroup[] = [];
  for (const g of GROUP_CONFIG) {
    const list = buckets.get(g.prefix)!;
    if (list.length > 0) groups.push({ label: g.label, agents: list });
  }
  const other = buckets.get("_other")!;
  if (other.length > 0) groups.push({ label: "其他", agents: other });
  return groups;
}

export function SidebarAgents() {
  const [open, setOpen] = useState(true);
  const { selectedCompanyId } = useCompany();
  const { openNewAgent } = useDialog();
  const { isMobile, setSidebarOpen } = useSidebar();
  const location = useLocation();

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });

  const liveCountByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of liveRuns ?? []) {
      counts.set(run.agentId, (counts.get(run.agentId) ?? 0) + 1);
    }
    return counts;
  }, [liveRuns]);

  const agentGroups = useMemo(() => {
    const filtered = (agents ?? []).filter(
      (a: Agent) => a.status !== "terminated"
    );
    return groupAgents(filtered);
  }, [agents]);

  const agentMatch = location.pathname.match(/^\/(?:[^/]+\/)?agents\/([^/]+)/);
  const activeAgentId = agentMatch?.[1] ?? null;

  // Track which groups are expanded (all collapsed by default)
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const isGroupOpen = (label: string) => groupOpen[label] === true; // default collapsed

  const renderAgent = (agent: Agent) => {
    const runCount = liveCountByAgent.get(agent.id) ?? 0;
    return (
      <NavLink
        key={agent.id}
        to={agentUrl(agent)}
        onClick={() => {
          if (isMobile) setSidebarOpen(false);
        }}
        className={cn(
          "flex items-center gap-2.5 px-3 py-1.5 text-[13px] font-medium transition-colors",
          activeAgentId === agentRouteRef(agent)
            ? "bg-accent text-foreground"
            : "text-foreground/80 hover:bg-accent/50 hover:text-foreground"
        )}
      >
        <AgentIcon icon={agent.icon} className="shrink-0 h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 truncate">{agent.name}</span>
        {(agent.pauseReason === "budget" || runCount > 0) && (
          <span className="ml-auto flex items-center gap-1.5 shrink-0">
            {agent.pauseReason === "budget" ? (
              <BudgetSidebarMarker title="Agent 因预算暂停" />
            ) : null}
            {runCount > 0 ? (
              <span className="relative flex h-2 w-2">
                <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
            ) : null}
            {runCount > 0 ? (
              <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                {runCount} 运行中
              </span>
            ) : null}
          </span>
        )}
      </NavLink>
    );
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group">
        <div className="flex items-center px-3 py-1.5">
          <CollapsibleTrigger className="flex items-center gap-1 flex-1 min-w-0">
            <ChevronRight
              className={cn(
                "h-3 w-3 text-muted-foreground/60 transition-transform opacity-0 group-hover:opacity-100",
                open && "rotate-90"
              )}
            />
            <span className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">
              Agents
            </span>
          </CollapsibleTrigger>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openNewAgent();
            }}
            className="flex items-center justify-center h-4 w-4 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/50 transition-colors"
            aria-label="New agent"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>

      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 mt-0.5">
          {agentGroups.map((group) => {
            const groupRunCount = group.agents.reduce(
              (sum, a) => sum + (liveCountByAgent.get(a.id) ?? 0),
              0
            );
            return (
              <div key={group.label}>
                <button
                  onClick={() =>
                    setGroupOpen((prev) => ({
                      ...prev,
                      [group.label]: !isGroupOpen(group.label),
                    }))
                  }
                  className="flex items-center gap-1 w-full px-3 py-1 text-left hover:bg-accent/30 transition-colors"
                >
                  <ChevronRight
                    className={cn(
                      "h-2.5 w-2.5 text-muted-foreground/50 transition-transform",
                      isGroupOpen(group.label) && "rotate-90"
                    )}
                  />
                  <span className="text-[10px] font-medium text-muted-foreground/70 tracking-wide">
                    {group.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground/40 ml-auto">
                    {group.agents.length}
                    {groupRunCount > 0 && (
                      <span className="ml-1 text-blue-500">●</span>
                    )}
                  </span>
                </button>
                {isGroupOpen(group.label) &&
                  group.agents.map(renderAgent)}
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
