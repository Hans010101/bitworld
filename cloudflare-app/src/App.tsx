import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileText,
  Flag,
  Gauge,
  Goal as GoalIcon,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { api } from "./api";
import type { Activity, Agent, Approval, Dashboard, Goal, Report, Run, Task } from "./types";

type Page = "dashboard" | "tasks" | "agents" | "goals" | "reports" | "finance" | "governance" | "settings";

const navigation: Array<{ label: string; items: Array<{ page: Page; label: string; icon: typeof Gauge }> }> = [
  { label: "运营", items: [
    { page: "dashboard", label: "总览", icon: LayoutDashboard },
    { page: "tasks", label: "工作台", icon: BriefcaseBusiness },
  ] },
  { label: "公司", items: [
    { page: "agents", label: "团队", icon: Users },
    { page: "goals", label: "目标", icon: Target },
  ] },
  { label: "知识", items: [
    { page: "reports", label: "情报与报告", icon: FileText },
  ] },
  { label: "管控", items: [
    { page: "finance", label: "预算", icon: CircleDollarSign },
    { page: "governance", label: "治理", icon: ShieldCheck },
    { page: "settings", label: "设置", icon: Settings },
  ] },
];

const pageMeta: Record<Page, { eyebrow: string; title: string; subtitle: string }> = {
  dashboard: { eyebrow: "COMPANY PULSE", title: "早上好，Hans", subtitle: "今天公司运行平稳，有 3 件事值得你关注。" },
  tasks: { eyebrow: "WORK CONTROL", title: "工作台", subtitle: "用任务承接指令，用运行记录验证真正交付。" },
  agents: { eyebrow: "ORGANIZATION", title: "AI 团队", subtitle: "按事业部查看每个 Agent 的状态、职责与成本。" },
  goals: { eyebrow: "DIRECTION", title: "公司目标", subtitle: "让每个任务都回到可衡量的经营结果。" },
  reports: { eyebrow: "INTELLIGENCE", title: "情报与报告", subtitle: "从信息堆积转向可执行的决策输入。" },
  finance: { eyebrow: "CAPITAL CONTROL", title: "预算与用量", subtitle: "把模型成本看作投资，持续观察投入产出。" },
  governance: { eyebrow: "GOVERNANCE", title: "审批与审计", subtitle: "高风险动作必须有人类确认，所有动作都可追溯。" },
  settings: { eyebrow: "SYSTEM", title: "运行设置", subtitle: "Cloudflare 原生部署状态与安全边界。" },
};

const statusLabels: Record<string, string> = {
  active: "在线", working: "执行中", paused: "已暂停", error: "异常",
  backlog: "待规划", todo: "待执行", in_progress: "进行中", in_review: "待验收", done: "已完成", blocked: "受阻",
  pending: "待审批", approved: "已批准", rejected: "已拒绝", queued: "排队中", running: "执行中", succeeded: "已成功", failed: "失败",
};

const priorityLabels: Record<string, string> = { urgent: "紧急", high: "高", medium: "中", low: "低" };

function money(value: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function relativeTime(value: string | null) {
  if (!value) return "暂无记录";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function StatusPill({ value }: { value: string }) {
  return <span className={`status-pill status-${value}`}><span />{statusLabels[value] ?? value}</span>;
}

function Empty({ icon: Icon = Sparkles, title, body }: { icon?: typeof Sparkles; title: string; body: string }) {
  return <div className="empty-state"><Icon size={24} /><strong>{title}</strong><p>{body}</p></div>;
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try { await api.login(password); onSuccess(); }
    catch (err) { setError(err instanceof Error ? err.message : "登录失败"); }
    finally { setBusy(false); }
  }
  return <main className="login-shell">
    <div className="login-ambient ambient-one" /><div className="login-ambient ambient-two" />
    <section className="login-story">
      <Brand />
      <div className="story-copy">
        <span className="section-kicker">YOUR COMPANY, IN ONE VIEW</span>
        <h1>让一人公司<br />像一支精锐团队。</h1>
        <p>目标、任务、Agent、预算与决策，汇聚到一个安静而可靠的经营控制台。</p>
      </div>
      <div className="signal-row">
        <div><span className="signal-dot" />Cloudflare Edge</div>
        <div>受保护的私人控制台</div>
      </div>
    </section>
    <section className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark"><ShieldCheck size={22} /></div>
        <p className="section-kicker">BOARD ACCESS</p>
        <h2>进入 BitWorld</h2>
        <p className="muted">这是董事会入口。请输入部署时生成的管理密码。</p>
        <label>管理密码<input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" /></label>
        {error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}
        <button className="button primary wide" disabled={busy || password.length < 8}>{busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}{busy ? "验证中" : "安全进入"}</button>
        <small>会话采用 HttpOnly + SameSite Cookie，不在浏览器保存密码。</small>
      </form>
    </section>
  </main>;
}

function Brand() {
  return <div className="brand"><div className="brand-symbol"><span /><span /><span /></div><div><strong>BITWORLD</strong><small>COMPANY OS</small></div></div>;
}

function Shell({ page, setPage, children, onLogout, onRefresh, refreshing }: { page: Page; setPage: (page: Page) => void; children: ReactNode; onLogout: () => void; onRefresh: () => void; refreshing: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const meta = pageMeta[page];
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="sidebar-top"><Brand /><button className="icon-button mobile-only" onClick={() => setMobileOpen(false)}><X size={20} /></button></div>
      <nav>{navigation.map((group) => <div className="nav-group" key={group.label}><p>{group.label}</p>{group.items.map(({ page: itemPage, label, icon: Icon }) => <button key={itemPage} className={page === itemPage ? "active" : ""} onClick={() => { setPage(itemPage); setMobileOpen(false); }}><Icon size={18} /><span>{label}</span>{itemPage === "governance" && <i>2</i>}</button>)}</div>)}</nav>
      <div className="sidebar-foot">
        <div className="edge-status"><span /><div><strong>系统在线</strong><small>Cloudflare · SIN</small></div></div>
        <button className="logout-button" onClick={onLogout}><LogOut size={17} />退出</button>
      </div>
    </aside>
    <div className="main-area">
      <header className="topbar">
        <button className="icon-button mobile-only" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
        <div className="page-heading"><p>{meta.eyebrow}</p><h1>{meta.title}</h1><span>{meta.subtitle}</span></div>
        <div className="top-actions"><button className="icon-button search-button"><Search size={18} /></button><button className="button subtle" onClick={onRefresh} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "spin" : ""} />刷新</button><div className="avatar">HP</div></div>
      </header>
      <main className="content">{children}</main>
    </div>
  </div>;
}

function MetricCard({ label, value, note, icon: Icon, accent }: { label: string; value: string; note: string; icon: typeof Bot; accent?: "green" | "amber" }) {
  return <article className={`metric-card ${accent ?? ""}`}><div className="metric-head"><span>{label}</span><Icon size={17} /></div><strong>{value}</strong><p>{note}</p></article>;
}

function DashboardPage({ data, go }: { data: Dashboard; go: (page: Page) => void }) {
  const { metrics } = data;
  const budgetPercent = metrics.monthlyBudget ? Math.min(100, metrics.monthlySpend / metrics.monthlyBudget * 100) : 0;
  return <div className="dashboard-grid">
    <section className="metrics-grid full-span">
      <MetricCard label="在线团队" value={`${metrics.activeAgents}/${metrics.totalAgents}`} note="Agent 正常待命" icon={Bot} accent="green" />
      <MetricCard label="开放任务" value={String(metrics.openTasks)} note={`${metrics.completedThisWeek} 项本周完成`} icon={ClipboardCheck} />
      <MetricCard label="待你决策" value={String(metrics.pendingApprovals)} note="高风险动作需确认" icon={ShieldCheck} accent={metrics.pendingApprovals ? "amber" : undefined} />
      <MetricCard label="本月投入" value={money(metrics.monthlySpend)} note={`预算使用 ${budgetPercent.toFixed(0)}%`} icon={CircleDollarSign} />
    </section>
    <section className="panel attention-panel">
      <PanelTitle icon={Zap} eyebrow="BOARD INBOX" title="需要你的关注" action="查看全部" onAction={() => go("governance")} />
      <div className="attention-list">
        {data.attention.slice(0, 4).map((task) => <div className="attention-item" key={task.id}><div className={`priority-mark priority-${task.priority}`} /><div><strong>{task.title}</strong><p>{task.assignee_name || "尚未分配"} · {relativeTime(task.updated_at)}</p></div><StatusPill value={task.status} /></div>)}
        {!data.attention.length && <Empty icon={CheckCircle2} title="没有阻塞项" body="团队当前不需要你介入。" />}
      </div>
    </section>
    <section className="panel company-pulse">
      <PanelTitle icon={TrendingUp} eyebrow="OPERATING RHYTHM" title="公司脉搏" />
      <div className="pulse-score"><div><strong>82</strong><span>/ 100</span></div><p>运行健康</p></div>
      <div className="pulse-bars">
        {[{n:"执行效率",v:86},{n:"目标对齐",v:78},{n:"预算健康",v:92},{n:"交付质量",v:74}].map((x)=><div key={x.n}><span>{x.n}<b>{x.v}%</b></span><i><em style={{width:`${x.v}%`}} /></i></div>)}
      </div>
    </section>
    <section className="panel agents-panel">
      <PanelTitle icon={Network} eyebrow="TEAM STATUS" title="团队运行" action="查看组织" onAction={() => go("agents")} />
      <div className="agent-compact-grid">{data.agents.slice(0, 6).map((agent) => <div className="agent-compact" key={agent.id}><AgentAvatar agent={agent} /><div><strong>{agent.name}</strong><p>{agent.title}</p></div><StatusPill value={agent.status} /></div>)}</div>
    </section>
    <section className="panel output-panel">
      <PanelTitle icon={FileText} eyebrow="LATEST OUTPUT" title="最新产出" action="报告中心" onAction={() => go("reports")} />
      <div className="output-list">{data.reports.slice(0, 4).map((report)=><div key={report.id}><span className="doc-icon"><FileText size={17}/></span><div><strong>{report.title}</strong><p>{report.author} · {relativeTime(report.created_at)}</p></div><ArrowRight size={16}/></div>)}</div>
    </section>
    <section className="panel run-panel full-span">
      <PanelTitle icon={ActivityIcon} eyebrow="EXECUTION" title="最近运行" action="进入工作台" onAction={() => go("tasks")} />
      <RunTable runs={data.runs.slice(0, 6)} />
    </section>
  </div>;
}

function PanelTitle({ icon: Icon, eyebrow, title, action, onAction }: { icon: typeof Zap; eyebrow: string; title: string; action?: string; onAction?: () => void }) {
  return <div className="panel-title"><div className="panel-title-icon"><Icon size={17} /></div><div><p>{eyebrow}</p><h2>{title}</h2></div>{action && <button onClick={onAction}>{action}<ArrowRight size={14} /></button>}</div>;
}

function AgentAvatar({ agent }: { agent: Agent }) {
  const initials = agent.name.includes("-") ? agent.name.split("-")[0].slice(0,2) : agent.name.slice(0,2);
  return <div className={`agent-avatar division-${agent.division.toLowerCase().replace(/[^a-z]/g, "")}`}>{initials}</div>;
}

function TaskBoard({ tasks, agents, onCreate, onUpdate, onRun }: { tasks: Task[]; agents: Agent[]; onCreate: () => void; onUpdate: (id: string, input: Partial<Task>) => void; onRun: (task: Task) => void }) {
  const columns: Array<{ status: Task["status"]; label: string }> = [{status:"todo",label:"待执行"},{status:"in_progress",label:"进行中"},{status:"in_review",label:"待验收"},{status:"done",label:"已完成"}];
  return <>
    <div className="toolbar"><div className="segmented"><button className="active">看板</button><button>列表</button></div><div className="toolbar-actions"><button className="button subtle"><Search size={16}/>筛选</button><button className="button primary" onClick={onCreate}><Plus size={17}/>新建任务</button></div></div>
    <div className="kanban">{columns.map((column)=><section className="kanban-column" key={column.status}><header><span className={`column-dot dot-${column.status}`}/><strong>{column.label}</strong><b>{tasks.filter(t=>t.status===column.status).length}</b></header><div className="kanban-cards">{tasks.filter(t=>t.status===column.status).map(task=><article className="task-card" key={task.id}><div className="task-card-head"><span className={`priority-text priority-${task.priority}`}>{priorityLabels[task.priority]}</span><button><MoreHorizontal size={17}/></button></div><h3>{task.title}</h3><p>{task.description || "暂无任务说明"}</p><div className="task-meta"><span>{task.division}</span>{task.due_at && <span><Clock3 size={13}/>{new Date(task.due_at).toLocaleDateString("zh-CN")}</span>}</div><footer><div className="mini-agent">{task.assignee_name?.slice(0,2)||"待"}</div><div className="task-actions">{task.status !== "done" && <button title="运行 Agent" onClick={()=>onRun(task)}><Play size={14}/></button>}<select value={task.status} onChange={(e)=>onUpdate(task.id,{status:e.target.value as Task["status"]})}>{columns.map(c=><option key={c.status} value={c.status}>{c.label}</option>)}<option value="blocked">受阻</option></select></div></footer></article>)}</div></section>)}</div>
  </>;
}

function RunTable({ runs }: { runs: Run[] }) {
  return runs.length ? <div className="run-table"><div className="table-row table-head"><span>任务</span><span>执行者</span><span>模型</span><span>状态</span><span>时间</span></div>{runs.map(run=><div className="table-row" key={run.id}><span><strong>{run.task_title}</strong><small>{run.output_excerpt || "等待执行结果"}</small></span><span>{run.agent_name}</span><span className="mono">{run.model}</span><span><StatusPill value={run.status}/></span><span>{relativeTime(run.created_at)}</span></div>)}</div> : <Empty icon={Play} title="还没有运行记录" body="从任务卡片启动一个 Agent，运行结果会出现在这里。" />;
}

function AgentsPage({ agents, onUpdate }: { agents: Agent[]; onUpdate: (id: string, status: Agent["status"]) => void }) {
  const divisions = useMemo(()=>Array.from(new Set(agents.map(a=>a.division))),[agents]);
  const [division,setDivision]=useState("全部");
  const visible=division==="全部"?agents:agents.filter(a=>a.division===division);
  return <><div className="toolbar"><div className="filter-tabs"><button className={division==="全部"?"active":""} onClick={()=>setDivision("全部")}>全部 <b>{agents.length}</b></button>{divisions.map(d=><button className={division===d?"active":""} onClick={()=>setDivision(d)} key={d}>{d}</button>)}</div><button className="button primary"><Plus size={17}/>添加 Agent</button></div><div className="agent-card-grid">{visible.map(agent=><article className="agent-card" key={agent.id}><header><AgentAvatar agent={agent}/><StatusPill value={agent.status}/></header><h3>{agent.name}</h3><p className="agent-title">{agent.title}</p><div className="agent-division">{agent.division}</div><div className="agent-current"><small>当前任务</small><span>{agent.current_task||"等待新任务"}</span></div><div className="agent-stats"><div><small>本月成本</small><strong>{money(agent.monthly_spend)}</strong></div><div><small>预算</small><strong>{money(agent.monthly_budget)}</strong></div></div><footer><span>{relativeTime(agent.last_seen_at)}</span><button onClick={()=>onUpdate(agent.id,agent.status==="paused"?"active":"paused")}>{agent.status==="paused"?<><Play size={14}/>恢复</>:<><Pause size={14}/>暂停</>}</button></footer></article>)}</div></>;
}

function GoalsPage({ goals }: { goals: Goal[] }) {
  return <div className="goals-layout"><section className="north-star"><p className="section-kicker">NORTH STAR</p><h2>建立可持续运转的 AI 原生一人公司</h2><p>通过自动化情报、决策辅助与执行闭环，把创始人的时间集中在方向判断和关键关系上。</p><div><span><Flag size={15}/>2026 年度目标</span><b>Q3</b></div></section><section className="goal-list">{goals.map(goal=><article className="goal-card" key={goal.id}><div className="goal-icon"><GoalIcon size={19}/></div><div className="goal-body"><header><div><p>{goal.horizon} · {goal.owner}</p><h3>{goal.title}</h3></div><strong>{goal.progress}%</strong></header><p>{goal.description}</p><div className="goal-progress"><i><em style={{width:`${goal.progress}%`}}/></i><span>{goal.metric}: {goal.current_value} / {goal.target_value}</span></div></div></article>)}</section></div>;
}

function ReportsPage({ reports }: { reports: Report[] }) {
  const [selected,setSelected]=useState<Report|null>(reports[0]||null);
  useEffect(()=>{if(!selected&&reports[0])setSelected(reports[0]);},[reports,selected]);
  return <div className="reports-layout"><section className="report-list"><div className="report-search"><Search size={16}/><input placeholder="搜索报告与情报"/></div>{reports.map(report=><button className={selected?.id===report.id?"active":""} key={report.id} onClick={()=>setSelected(report)}><span className="doc-icon"><FileText size={17}/></span><div><small>{report.type}</small><strong>{report.title}</strong><p>{report.summary}</p><time>{report.author} · {relativeTime(report.created_at)}</time></div></button>)}</section><section className="report-reader">{selected?<><header><span>{selected.type}</span><h2>{selected.title}</h2><div>{selected.author}<i/> {new Date(selected.created_at).toLocaleString("zh-CN")}</div></header><div className="report-summary"><Sparkles size={18}/><p>{selected.summary}</p></div><article>{selected.content.split("\n").map((line,i)=>line.startsWith("## ")?<h3 key={i}>{line.slice(3)}</h3>:line?<p key={i}>{line}</p>:<br key={i}/>)}</article></>:<Empty icon={FileText} title="暂无报告" body="Agent 的交付会沉淀在这里。"/>}</section></div>;
}

function FinancePage({ agents }: { agents: Agent[] }) {
  const total=agents.reduce((s,a)=>s+a.monthly_budget,0), spend=agents.reduce((s,a)=>s+a.monthly_spend,0);
  const byDivision=Array.from(new Set(agents.map(a=>a.division))).map(d=>({name:d,budget:agents.filter(a=>a.division===d).reduce((s,a)=>s+a.monthly_budget,0),spend:agents.filter(a=>a.division===d).reduce((s,a)=>s+a.monthly_spend,0)}));
  return <div className="finance-grid"><section className="panel finance-hero"><p className="section-kicker">JULY ALLOCATION</p><div><strong>{money(spend)}</strong><span>of {money(total)} budget</span></div><div className="big-progress"><i style={{width:`${total?spend/total*100:0}%`}}/></div><footer><span><TrendingUp size={15}/>预计月底 {money(spend*1.42)}</span><span className="positive">预算健康</span></footer></section><section className="panel"><PanelTitle icon={BarChart3} eyebrow="BY DIVISION" title="事业部投入"/><div className="division-budget">{byDivision.map(d=><div key={d.name}><span>{d.name}<b>{money(d.spend)}</b></span><i><em style={{width:`${d.budget?Math.min(100,d.spend/d.budget*100):0}%`}}/></i><small>预算 {money(d.budget)}</small></div>)}</div></section><section className="panel full-span"><PanelTitle icon={Bot} eyebrow="AGENT ECONOMICS" title="Agent 成本明细"/><div className="data-table"><div className="data-head"><span>Agent</span><span>事业部</span><span>模型</span><span>已使用</span><span>预算占比</span></div>{[...agents].sort((a,b)=>b.monthly_spend-a.monthly_spend).map(a=><div key={a.id}><span><AgentAvatar agent={a}/><strong>{a.name}</strong></span><span>{a.division}</span><span className="mono">{a.model}</span><span>{money(a.monthly_spend)}</span><span>{a.monthly_budget?Math.round(a.monthly_spend/a.monthly_budget*100):0}%</span></div>)}</div></section></div>;
}

function GovernancePage({ approvals, activity, onDecision }: { approvals: Approval[]; activity: Activity[]; onDecision: (id:string,decision:"approved"|"rejected")=>void }) {
  return <div className="governance-grid"><section className="panel"><PanelTitle icon={ClipboardCheck} eyebrow="DECISIONS" title="待审批事项"/><div className="approval-list">{approvals.filter(a=>a.status==="pending").map(a=><article key={a.id}><header><span className={`risk risk-${a.risk}`}>{a.risk.toUpperCase()}</span><small>{a.type}</small></header><h3>{a.title}</h3><p>{a.rationale}</p><footer><span>{a.requested_by} · {relativeTime(a.created_at)}</span><div><button className="decision reject" onClick={()=>onDecision(a.id,"rejected")}><XCircle size={15}/>拒绝</button><button className="decision approve" onClick={()=>onDecision(a.id,"approved")}><Check size={15}/>批准</button></div></footer></article>)}{!approvals.some(a=>a.status==="pending")&&<Empty icon={CheckCircle2} title="决策箱已清空" body="当前没有等待你批准的高风险动作。"/>}</div></section><section className="panel"><PanelTitle icon={ActivityIcon} eyebrow="AUDIT TRAIL" title="最近活动"/><div className="timeline">{activity.map(item=><div key={item.id}><span className="timeline-dot"/><div><strong>{item.summary}</strong><p>{item.actor} · {relativeTime(item.created_at)}</p></div></div>)}</div></section></div>;
}

function SettingsPage() {
  return <div className="settings-grid"><section className="panel setting-card"><div className="setting-icon green"><CheckCircle2/></div><div><p className="section-kicker">DEPLOYMENT</p><h3>Cloudflare Workers</h3><p>静态资源与 API 已部署到全球边缘网络，使用免费的 workers.dev 域名。</p></div><StatusPill value="active"/></section><section className="panel setting-card"><div className="setting-icon"><Gauge/></div><div><p className="section-kicker">DATABASE</p><h3>Cloudflare D1</h3><p>公司、任务、Agent、报告与审计数据使用原生 SQL 绑定。</p></div><StatusPill value="active"/></section><section className="panel setting-card"><div className="setting-icon"><ActivityIcon/></div><div><p className="section-kicker">EXECUTION</p><h3>Cloudflare Queues</h3><p>Agent 运行与网页请求解耦，失败自动重试并写入运行记录。</p></div><StatusPill value="active"/></section><section className="panel setting-card"><div className="setting-icon amber"><ShieldCheck/></div><div><p className="section-kicker">SECURITY</p><h3>Board-only Access</h3><p>管理密码通过 Worker Secret 注入，登录失败受频率限制。</p></div><StatusPill value="active"/></section><section className="panel architecture-card full-span"><PanelTitle icon={Network} eyebrow="ARCHITECTURE" title="系统边界"/><div className="architecture-flow"><div><strong>React UI</strong><small>全球静态资源</small></div><ArrowRight/><div><strong>Worker API</strong><small>认证与业务逻辑</small></div><ArrowRight/><div><strong>D1 + Queue</strong><small>状态与异步执行</small></div><ArrowRight/><div><strong>DashScope</strong><small>模型推理</small></div></div><p>旧版 Paperclip 仍保留在仓库中，Cloudflare 版本独立运行，后续可分阶段迁移高级插件与更多自动化。</p></section></div>;
}

function TaskModal({ agents, onClose, onCreate }: { agents: Agent[]; onClose:()=>void; onCreate:(input:Partial<Task>)=>void }) {
  const [title,setTitle]=useState(""),[description,setDescription]=useState(""),[agent,setAgent]=useState(""),[priority,setPriority]=useState<Task["priority"]>("medium");
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();onCreate({title,description,assignee_agent_id:agent||null,priority,status:"todo",division:agents.find(a=>a.id===agent)?.division||"总部"});}}><header><div><p className="section-kicker">NEW WORK ITEM</p><h2>创建任务</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={20}/></button></header><label>任务名称<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder="明确描述需要交付的结果"/></label><label>任务背景<textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="为什么做、成功标准、重要约束"/></label><div className="form-row"><label>执行 Agent<select value={agent} onChange={e=>setAgent(e.target.value)}><option value="">暂不分配</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name} · {a.title}</option>)}</select></label><label>优先级<select value={priority} onChange={e=>setPriority(e.target.value as Task["priority"])}><option value="urgent">紧急</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label></div><footer><button type="button" className="button subtle" onClick={onClose}>取消</button><button className="button primary" disabled={!title.trim()}><Plus size={16}/>创建任务</button></footer></form></div>;
}

export default function App() {
  const [authenticated,setAuthenticated]=useState<boolean|null>(null),[page,setPage]=useState<Page>("dashboard"),[dashboard,setDashboard]=useState<Dashboard|null>(null);
  const [agents,setAgents]=useState<Agent[]>([]),[tasks,setTasks]=useState<Task[]>([]),[goals,setGoals]=useState<Goal[]>([]),[reports,setReports]=useState<Report[]>([]),[approvals,setApprovals]=useState<Approval[]>([]),[activity,setActivity]=useState<Activity[]>([]);
  const [refreshing,setRefreshing]=useState(false),[error,setError]=useState(""),[modal,setModal]=useState(false);
  useEffect(()=>{api.session().then(x=>setAuthenticated(x.authenticated)).catch(()=>setAuthenticated(false));},[]);
  const load=useCallback(async()=>{if(!authenticated)return;setRefreshing(true);setError("");try{const [d,a,t,g,r,ap,ac]=await Promise.all([api.dashboard(),api.agents(),api.tasks(),api.goals(),api.reports(),api.approvals(),api.activity()]);setDashboard(d);setAgents(a.items);setTasks(t.items);setGoals(g.items);setReports(r.items);setApprovals(ap.items);setActivity(ac.items);}catch(err){const message=err instanceof Error?err.message:"加载失败";if(message.includes("未登录")){setAuthenticated(false);}else setError(message);}finally{setRefreshing(false);}},[authenticated]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{if(!authenticated)return;const timer=setInterval(()=>void load(),30000);return()=>clearInterval(timer);},[authenticated,load]);
  async function updateTask(id:string,input:Partial<Task>){try{await api.updateTask(id,input);await load();}catch(e){setError(e instanceof Error?e.message:"更新失败");}}
  async function createTask(input:Partial<Task>){try{await api.createTask(input);setModal(false);await load();}catch(e){setError(e instanceof Error?e.message:"创建失败");}}
  async function runTask(task:Task){try{await api.runTask(task.id,task.assignee_agent_id);await load();}catch(e){setError(e instanceof Error?e.message:"启动失败");}}
  async function updateAgent(id:string,status:Agent["status"]){try{await api.updateAgent(id,status);await load();}catch(e){setError(e instanceof Error?e.message:"更新失败");}}
  async function decide(id:string,decision:"approved"|"rejected"){try{await api.decideApproval(id,decision);await load();}catch(e){setError(e instanceof Error?e.message:"审批失败");}}
  if(authenticated===null)return <div className="boot"><div className="brand-symbol"><span/><span/><span/></div><LoaderCircle className="spin"/></div>;
  if(!authenticated)return <Login onSuccess={()=>setAuthenticated(true)}/>;
  return <Shell page={page} setPage={setPage} onRefresh={()=>void load()} refreshing={refreshing} onLogout={async()=>{await api.logout();setAuthenticated(false);}}>
    {error&&<div className="global-error"><AlertTriangle size={17}/><span>{error}</span><button onClick={()=>setError("")}><X size={16}/></button></div>}
    {!dashboard&&refreshing?<div className="page-loading"><LoaderCircle className="spin"/><span>正在同步公司状态…</span></div>:<>
      {page==="dashboard"&&dashboard&&<DashboardPage data={dashboard} go={setPage}/>} 
      {page==="tasks"&&<><TaskBoard tasks={tasks} agents={agents} onCreate={()=>setModal(true)} onUpdate={updateTask} onRun={runTask}/><section className="panel runs-section"><PanelTitle icon={ActivityIcon} eyebrow="RUN HISTORY" title="Agent 运行记录"/><RunTable runs={dashboard?.runs||[]}/></section></>}
      {page==="agents"&&<AgentsPage agents={agents} onUpdate={updateAgent}/>} 
      {page==="goals"&&<GoalsPage goals={goals}/>} 
      {page==="reports"&&<ReportsPage reports={reports}/>} 
      {page==="finance"&&<FinancePage agents={agents}/>} 
      {page==="governance"&&<GovernancePage approvals={approvals} activity={activity} onDecision={decide}/>} 
      {page==="settings"&&<SettingsPage/>}
    </>}
    {modal&&<TaskModal agents={agents} onClose={()=>setModal(false)} onCreate={createTask}/>} 
  </Shell>;
}
