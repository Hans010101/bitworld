import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BellRing,
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  Download,
  FileText,
  Flag,
  Gauge,
  Goal as GoalIcon,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Radio,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Users,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { api } from "./api";
import type { AccountState, AccountUser, Activity, Agent, AiRouting, Approval, AuthUser, Dashboard, Goal, NotificationChannel, NotificationDelivery, NotificationEvent, NotificationProvider, Report, Run, ScheduledTask, Task } from "./types";

type Page = "dashboard" | "tasks" | "schedules" | "agents" | "goals" | "reports" | "finance" | "governance" | "settings";

const navigation: Array<{ label: string; items: Array<{ page: Page; label: string; icon: typeof Gauge }> }> = [
  { label: "运营", items: [
    { page: "dashboard", label: "总览", icon: LayoutDashboard },
    { page: "tasks", label: "工作台", icon: BriefcaseBusiness },
    { page: "schedules", label: "定时任务", icon: CalendarClock },
  ] },
  { label: "公司", items: [
    { page: "agents", label: "团队", icon: Users },
    { page: "goals", label: "目标", icon: Target },
  ] },
  { label: "知识", items: [
    { page: "reports", label: "决策情报", icon: FileText },
  ] },
  { label: "管控", items: [
    { page: "finance", label: "用量", icon: Gauge },
    { page: "governance", label: "治理", icon: ShieldCheck },
    { page: "settings", label: "设置", icon: Settings },
  ] },
];

const pageMeta: Record<Page, { eyebrow: string; title: string; subtitle: string }> = {
  dashboard: { eyebrow: "公司动态", title: "经营总览", subtitle: "查看当前账号的任务、团队、用量与最新成果。" },
  tasks: { eyebrow: "工作管控", title: "工作台", subtitle: "用任务承接指令，用运行记录验证真正交付。" },
  schedules: { eyebrow: "自动经营", title: "定时任务", subtitle: "让董秘按节奏自动派单，事业部持续产出可验收结果。" },
  agents: { eyebrow: "组织架构", title: "AI 团队", subtitle: "按事业部查看每个 Agent 的状态、职责与 Token 用量。" },
  goals: { eyebrow: "经营方向", title: "公司目标", subtitle: "让每个任务都回到可衡量的经营结果。" },
  reports: { eyebrow: "决策情报", title: "决策情报中心", subtitle: "汇总事业部成果，提炼判断、风险与待决事项。" },
  finance: { eyebrow: "模型资源", title: "Token 用量", subtitle: "按 Agent 和事业部观察真实输入、输出与月度使用趋势。" },
  governance: { eyebrow: "公司治理", title: "审批与审计", subtitle: "高风险动作必须有人类确认，所有动作都可追溯。" },
  settings: { eyebrow: "系统设置", title: "运行设置", subtitle: "Cloudflare 原生部署状态、账号与安全边界。" },
};

const statusLabels: Record<string, string> = {
  active: "在线", working: "执行中", paused: "已暂停", error: "异常",
  backlog: "待规划", todo: "待执行", in_progress: "进行中", in_review: "待验收", done: "已完成", blocked: "受阻",
  pending: "待审批", approved: "已批准", rejected: "已拒绝", queued: "排队中", running: "执行中", succeeded: "已成功", failed: "失败",
};

const priorityLabels: Record<string, string> = { urgent: "紧急", high: "高", medium: "中", low: "低" };
const riskLabels: Record<string, string> = { low: "低风险", medium: "中风险", high: "高风险" };
const approvalTypeLabels: Record<string, string> = { budget_change: "预算调整", security_change: "安全变更", architecture: "架构决策" };

function formatTokens(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  if (safeValue >= 100_000_000) return `${Number((safeValue / 100_000_000).toFixed(1))} 亿 Token`;
  if (safeValue >= 10_000) return `${Number((safeValue / 10_000).toFixed(1))} 万 Token`;
  return `${new Intl.NumberFormat("zh-CN").format(safeValue)} Token`;
}

function formatNeurons(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(safeValue)} Neurons`;
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

function Login({ onSuccess, googleConfigured, emailConfigured }: { onSuccess: () => void; googleConfigured: boolean; emailConfigured: boolean }) {
  const [mode, setMode] = useState<"login" | "register" | "password" | "admin">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(() => new URLSearchParams(window.location.search).get("auth_notice") || "");
  const [busy, setBusy] = useState(false);
  function switchMode(next: typeof mode) {
    setMode(next); setError(""); setNotice(""); setPassword(""); setCode(""); setCodeSent(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "admin") {
        await api.adminLogin(password);
        onSuccess();
      } else if (mode === "password") {
        await api.login(email, password);
        onSuccess();
      } else {
        const purpose = mode;
        if (!codeSent) {
          const result = await api.requestEmailCode(email, purpose, purpose === "register" ? displayName : undefined);
          setCodeSent(true); setNotice(result.message); setCode("");
          return;
        }
        const result = await api.verifyEmailCode(email, code, purpose);
        if (result.pending) {
          setNotice(result.message || "邮箱验证成功，请稍后登录");
          setCodeSent(false); setCode("");
        } else onSuccess();
      }
    }
    catch (err) { setError(err instanceof Error ? err.message : "登录失败"); }
    finally { setBusy(false); }
  }
  return <main className="login-shell">
    <div className="login-ambient ambient-one" /><div className="login-ambient ambient-two" />
    <section className="login-story">
      <Brand />
      <div className="story-copy">
        <span className="section-kicker">一屏掌握公司全局</span>
        <h1>让一人公司<br />像一支精锐团队。</h1>
        <p>目标、任务、Agent、Token 用量与决策，汇聚到一个安静而可靠的经营控制台。</p>
      </div>
      <div className="signal-row">
        <div><span className="signal-dot" />Cloudflare 边缘网络</div>
        <div>受保护的私人控制台</div>
      </div>
    </section>
    <section className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark"><ShieldCheck size={22} /></div>
        <p className="section-kicker">账号访问</p>
        <h2>{mode === "register" ? "创建账号" : mode === "admin" ? "备用管理入口" : "登录 BitWorld"}</h2>
        <p className="muted">{mode === "register" ? "验证邮箱后立即创建独立公司空间，数据与其他账号完全隔离。" : mode === "admin" ? "使用部署时设置的共享管理密码进入所有者账号。" : mode === "password" ? "使用已有邮箱与密码登录。" : "使用 Resend 邮箱验证码安全登录。"}</p>
        {mode !== "admin" && <><button type="button" className="google-button" disabled={!googleConfigured || busy} onClick={() => { window.location.href = "/api/auth/google/start"; }}><b>G</b>{googleConfigured ? "使用 Google 账号继续" : "Google 登录待配置"}</button>
        <div className="login-divider"><span>或使用邮箱</span></div>
        <div className="auth-tabs"><button type="button" className={mode !== "register" ? "active" : ""} onClick={() => switchMode("login")}>登录</button><button type="button" className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>注册</button></div></>}
        {mode === "register" && <label>姓名<input autoFocus autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="你的姓名" /></label>}
        {mode !== "admin" && <label>邮箱<input autoFocus={mode !== "register"} disabled={codeSent} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></label>}
        {(mode === "login" || mode === "register") && codeSent && <label>邮箱验证码<input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="输入 6 位验证码" /></label>}
        {(mode === "password" || mode === "admin") && <label>{mode === "admin" ? "备用管理密码" : "密码"}<input autoFocus={mode === "admin"} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "admin" ? "输入共享管理密码" : "输入密码"} /></label>}
        {notice && <div className="form-notice"><CheckCircle2 size={16} />{notice}</div>}
        {error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}
        <button className="button primary wide" disabled={busy || ((mode === "login" || mode === "register") && (!emailConfigured || !email || (codeSent && code.length !== 6) || (mode === "register" && !displayName))) || ((mode === "password" || mode === "admin") && (!password || (mode === "password" && !email)))}>{busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}{busy ? "正在处理" : mode === "admin" ? "使用备用密码登录" : mode === "password" ? "使用密码登录" : !emailConfigured ? "邮箱登录待配置" : codeSent ? (mode === "register" ? "验证并创建账号" : "验证并登录") : "发送邮箱验证码"}</button>
        {codeSent && (mode === "login" || mode === "register") && <button type="button" className="backup-login-button" onClick={() => { setCodeSent(false); setCode(""); setNotice(""); }}>更换邮箱或重新获取验证码</button>}
        {mode !== "admin" && <button type="button" className="backup-login-button" onClick={() => switchMode(mode === "password" ? "login" : "password")}>{mode === "password" ? "返回邮箱验证码登录" : "使用已有密码登录"}</button>}
        <button type="button" className="backup-login-button" onClick={() => switchMode(mode === "admin" ? "login" : "admin")}>{mode === "admin" ? "返回账号登录" : "使用备用管理密码"}</button>
        <small>验证码由 Resend 安全投递，10 分钟内有效；会话使用 HttpOnly Cookie。</small>
      </form>
    </section>
  </main>;
}

function Brand() {
  return <div className="brand"><div className="brand-symbol"><span /><span /><span /></div><div><strong>BITWORLD</strong><small>一人公司操作系统</small></div></div>;
}

function Shell({ page, setPage, children, onLogout, onRefresh, refreshing, user }: { page: Page; setPage: (page: Page) => void; children: ReactNode; onLogout: () => void; onRefresh: () => void; refreshing: boolean; user: AuthUser }) {
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
        <div className="top-actions"><button className="icon-button search-button"><Search size={18} /></button><button className="button subtle" onClick={onRefresh} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "spin" : ""} />刷新</button><div className="avatar" title={`${user.displayName} · ${user.email}`}>{user.displayName.slice(0, 2).toUpperCase()}</div></div>
      </header>
      <main className="content">{children}</main>
    </div>
  </div>;
}

function MetricCard({ label, value, note, icon: Icon, accent }: { label: string; value: string; note: string; icon: typeof Bot; accent?: "green" | "amber" }) {
  return <article className={`metric-card ${accent ?? ""}`}><div className="metric-head"><span>{label}</span><Icon size={17} /></div><strong>{value}</strong><p>{note}</p></article>;
}

function OnboardingBanner({ account, go, onDismiss }: { account: AccountState; go: (page: Page) => void; onDismiss: () => void }) {
  if (account.onboardingCompleted) return null;
  const steps = [
    { done: account.setup.notificationConnected, label: "连接 Telegram 或飞书", page: "settings" as Page },
    { done: account.setup.scheduleCreated, label: "建立第一个定时任务", page: "schedules" as Page },
    { done: account.setup.firstTaskCreated, label: "创建或发送第一个任务", page: "tasks" as Page },
  ];
  const completed = steps.filter((step) => step.done).length;
  return <section className="onboarding-banner">
    <div className="onboarding-copy"><span className="section-kicker">独立公司空间已就绪</span><h2>三步开始使用 {account.companyName}</h2><p>你的任务、报告、Agent 用量、定时任务与通知凭据只属于当前账号。</p></div>
    <div className="onboarding-steps">{steps.map((step, index) => <button key={step.label} className={step.done ? "done" : ""} onClick={() => go(step.page)}><span>{step.done ? <Check size={15}/> : index + 1}</span>{step.label}<ArrowRight size={14}/></button>)}</div>
    <button className="onboarding-dismiss" onClick={onDismiss}>{completed === steps.length ? "完成设置" : "暂时跳过"}</button>
  </section>;
}

function DashboardPage({ data, go }: { data: Dashboard; go: (page: Page) => void }) {
  const { metrics } = data;
  return <div className="dashboard-grid">
    <section className="metrics-grid full-span">
      <MetricCard label="在线团队" value={`${metrics.activeAgents}/${metrics.totalAgents}`} note="Agent 正常待命" icon={Bot} accent="green" />
      <MetricCard label="开放任务" value={String(metrics.openTasks)} note={`${metrics.completedThisWeek} 项本周完成`} icon={ClipboardCheck} />
      <MetricCard label="待你决策" value={String(metrics.pendingApprovals)} note="高风险动作需确认" icon={ShieldCheck} accent={metrics.pendingApprovals ? "amber" : undefined} />
      <MetricCard label="本月 Token" value={formatTokens(metrics.monthlyTokensUsed)} note="模型返回的真实用量" icon={Gauge} />
    </section>
    <section className="panel attention-panel">
      <PanelTitle icon={Zap} eyebrow="董事会待办" title="需要你的关注" action="查看全部" onAction={() => go("governance")} />
      <div className="attention-list">
        {data.attention.slice(0, 4).map((task) => <div className="attention-item" key={task.id}><div className={`priority-mark priority-${task.priority}`} /><div><strong>{task.title}</strong><p>{task.assignee_name || "尚未分配"} · {relativeTime(task.updated_at)}</p></div><StatusPill value={task.status} /></div>)}
        {!data.attention.length && <Empty icon={CheckCircle2} title="没有阻塞项" body="团队当前不需要你介入。" />}
      </div>
    </section>
    <section className="panel company-pulse">
      <PanelTitle icon={TrendingUp} eyebrow="经营节奏" title="公司脉搏" />
      <div className="pulse-score"><div><strong>82</strong><span>/ 100</span></div><p>运行健康</p></div>
      <div className="pulse-bars">
        {[{n:"执行效率",v:86},{n:"目标对齐",v:78},{n:"用量透明",v:92},{n:"交付质量",v:74}].map((x)=><div key={x.n}><span>{x.n}<b>{x.v}%</b></span><i><em style={{width:`${x.v}%`}} /></i></div>)}
      </div>
    </section>
    <section className="panel agents-panel">
      <PanelTitle icon={Network} eyebrow="团队状态" title="团队运行" action="查看组织" onAction={() => go("agents")} />
      <div className="agent-compact-grid">{data.agents.slice(0, 6).map((agent) => <div className="agent-compact" key={agent.id}><AgentAvatar agent={agent} /><div><strong>{agent.name}</strong><p>{agent.title}</p></div><StatusPill value={agent.status} /></div>)}</div>
    </section>
    <section className="panel output-panel">
      <PanelTitle icon={FileText} eyebrow="最新产出" title="近期报告" action="报告中心" onAction={() => go("reports")} />
      <div className="output-list">{data.reports.slice(0, 4).map((report)=><div key={report.id}><span className="doc-icon"><FileText size={17}/></span><div><strong>{report.title}</strong><p>{report.author} · {relativeTime(report.created_at)}</p></div><ArrowRight size={16}/></div>)}</div>
    </section>
    <section className="panel run-panel full-span">
      <PanelTitle icon={ActivityIcon} eyebrow="执行记录" title="最近运行" action="进入工作台" onAction={() => go("tasks")} />
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
    <section className="workflow-strip"><div><span>1</span><strong>董秘受理</strong><small>确认任务与双成果交付</small></div><ArrowRight/><div><span>2</span><strong>集团 CEO 统筹</strong><small>路由到相应事业部 CEO</small></div><ArrowRight/><div><span>3</span><strong>事业部执行</strong><small>CEO 分派职能 Agent</small></div><ArrowRight/><div><span>4</span><strong>逐级整合</strong><small>职能 → 事业部 CEO → 董秘</small></div><ArrowRight/><div><span>5</span><strong>成果交付</strong><small>聊天摘要 + 中文 PDF</small></div></section>
    <div className="toolbar"><div className="segmented"><button className="active">看板</button><button>列表</button></div><div className="toolbar-actions"><button className="button subtle"><Search size={16}/>筛选</button><button className="button primary" onClick={onCreate}><Plus size={17}/>董秘派单</button></div></div>
    <div className="kanban">{columns.map((column)=><section className="kanban-column" key={column.status}><header><span className={`column-dot dot-${column.status}`}/><strong>{column.label}</strong><b>{tasks.filter(t=>t.status===column.status).length}</b></header><div className="kanban-cards">{tasks.filter(t=>t.status===column.status).map(task=><article className="task-card" key={task.id}><div className="task-card-head"><span className={`priority-text priority-${task.priority}`}>{priorityLabels[task.priority]}</span><span className={`task-source source-${task.source}`}>{task.source === "schedule" ? "自动派单" : task.source === "secretary" ? "董秘派单" : "直接任务"}</span></div><h3>{task.title}</h3><p>{task.description || "暂无任务说明"}</p>{task.output_requirements&&<div className="delivery-standard"><strong>交付标准</strong>{task.output_requirements}</div>}<div className="task-meta"><span>{task.division}</span><span>{task.assignee_name||"待分配"}</span>{Boolean(task.company_source_count)&&<span>{task.company_source_count} 条实时来源</span>}</div><footer><div className="workflow-stage">{task.company_workflow_status === "failed" ? "执行失败" : task.workflow_stage === "secretary_intake" ? "集团 CEO 统筹" : task.workflow_stage === "division_review" ? "事业部 CEO 整合" : task.workflow_stage === "secretary_synthesis" ? "董秘终稿" : task.workflow_stage === "archived" ? "双成果已交付" : "事业部执行"}</div><div className="task-actions">{task.status !== "done" && !task.company_workflow_id && <button title="运行 Agent" onClick={()=>onRun(task)}><Play size={14}/></button>}<select value={task.status} onChange={(e)=>onUpdate(task.id,{status:e.target.value as Task["status"]})}>{columns.map(c=><option key={c.status} value={c.status}>{c.label}</option>)}<option value="blocked">受阻</option></select></div></footer></article>)}</div></section>)}</div>
  </>;
}

function RunTable({ runs }: { runs: Run[] }) {
  return runs.length ? <div className="run-table"><div className="table-row table-head"><span>任务</span><span>执行者</span><span>模型路由</span><span>资源用量</span><span>状态</span><span>时间</span></div>{runs.map(run=><div className="table-row" key={run.id}><span><strong>{run.task_title}</strong><small>{run.output_excerpt || "等待执行结果"}</small></span><span>{run.agent_name}</span><span className="model-route-cell"><em className={`provider-badge provider-${run.provider}`}>{run.provider === "cloudflare" ? "Cloudflare" : run.provider === "deepseek" ? "DeepSeek" : "待路由"}</em><small className="mono">{run.model}</small></span><span className="usage-cell"><strong>{formatTokens(run.total_tokens)}</strong>{run.provider === "cloudflare" && <small>{formatNeurons(run.neurons_used)}</small>}</span><span><StatusPill value={run.status}/></span><span>{relativeTime(run.created_at)}</span></div>)}</div> : <Empty icon={Play} title="还没有运行记录" body="从任务卡片启动一个 Agent，运行结果会出现在这里。" />;
}

function AgentsPage({ agents, canCreate, onCreate, onUpdate, onConfigure }: { agents: Agent[]; canCreate: boolean; onCreate: () => void; onUpdate: (id: string, status: Agent["status"]) => void; onConfigure: (agent: Agent) => void }) {
  const divisions = useMemo(()=>Array.from(new Set(agents.map(a=>a.division))),[agents]);
  const [division,setDivision]=useState("全部");
  const visible=division==="全部"?agents:agents.filter(a=>a.division===division);
  return <><div className="org-principle"><Network size={20}/><div><strong>总部统筹 + 事业部专业执行</strong><p>事业部由 Agent 的归属动态生成，可持续扩充；总部保留目标、派单、复核与治理权。</p></div></div><div className="toolbar"><div className="filter-tabs"><button className={division==="全部"?"active":""} onClick={()=>setDivision("全部")}>全部 <b>{agents.length}</b></button>{divisions.map(d=><button className={division===d?"active":""} onClick={()=>setDivision(d)} key={d}>{d}</button>)}</div>{canCreate&&<button className="button primary" onClick={onCreate}><Plus size={17}/>添加 Agent</button>}</div><div className="agent-card-grid">{visible.map(agent=><article className="agent-card" key={agent.id}><header><AgentAvatar agent={agent}/><StatusPill value={agent.status}/></header><h3>{agent.name}</h3><p className="agent-title">{agent.title}</p><div className="agent-card-tags"><span className="agent-division">{agent.division}</span><span className={`model-tier ${agent.model==="deepseek-v4-pro"?"pro":"flash"}`}>{agent.model==="deepseek-v4-pro"?"V4 Pro · 统筹":"V4 Flash · 执行"}</span></div><div className="agent-current"><small>当前任务</small><span>{agent.current_task||"等待新任务"}</span></div><div className="runtime-summary"><span>推理 {agent.reasoning_mode === "high" ? "增强" : agent.reasoning_mode === "off" ? "关闭" : "自动"}</span><span>最长 {agent.execution_timeout_sec}s</span><span>{agent.max_output_tokens} 输出 Token</span></div><div className="agent-stats"><div><small>输入 Token</small><strong>{formatTokens(agent.monthly_input_tokens)}</strong></div><div><small>输出 Token</small><strong>{formatTokens(agent.monthly_output_tokens)}</strong></div></div><footer><span>{relativeTime(agent.last_seen_at)}</span>{canCreate&&<div><button onClick={()=>onConfigure(agent)}><SlidersHorizontal size={14}/>运行机制</button><button onClick={()=>onUpdate(agent.id,agent.status==="paused"?"active":"paused")}>{agent.status==="paused"?<><Play size={14}/>恢复</>:<><Pause size={14}/>暂停</>}</button></div>}</footer></article>)}</div></>;
}

function GoalsPage({ goals }: { goals: Goal[] }) {
  return <div className="goals-layout"><section className="north-star"><p className="section-kicker">北极星目标</p><h2>建立可持续运转的 AI 原生一人公司</h2><p>通过自动化情报、决策辅助与执行闭环，把创始人的时间集中在方向判断和关键关系上。</p><div><span><Flag size={15}/>2026 年度目标</span><b>第三季度</b></div></section><section className="goal-list">{goals.map(goal=><article className="goal-card" key={goal.id}><div className="goal-icon"><GoalIcon size={19}/></div><div className="goal-body"><header><div><p>{goal.horizon} · {goal.owner}</p><h3>{goal.title}</h3></div><strong>{goal.progress}%</strong></header><p>{goal.description}</p><div className="goal-progress"><i><em style={{width:`${goal.progress}%`}}/></i><span>{goal.metric}: {goal.current_value} / {goal.target_value}</span></div></div></article>)}</section></div>;
}

const frequencyLabels: Record<ScheduledTask["frequency"], string> = { hourly: "每小时", daily: "每天", weekdays: "工作日", weekly: "每周", monthly: "每月" };

function SchedulesPage({ schedules, canManage, onCreate, onToggle, onDelete }: { schedules: ScheduledTask[]; canManage: boolean; onCreate: () => void; onToggle: (item: ScheduledTask) => void; onDelete: (item: ScheduledTask) => void }) {
  return <><section className="schedule-intro"><div><CalendarClock size={22}/><div><strong>董秘自动调度台</strong><p>到点后自动运行完整研究工作流，并向指定渠道发送核心摘要与 PDF 报告。</p></div></div>{canManage&&<button className="button primary" onClick={onCreate}><Plus size={16}/>新建定时任务</button>}</section><div className="schedule-grid">{schedules.map(item=><article className={`schedule-card ${item.enabled?"is-enabled":""}`} key={item.id}><header><div className="schedule-icon"><CalendarClock size={18}/></div><label className="switch"><input type="checkbox" checked={item.enabled} disabled={!canManage} onChange={()=>onToggle(item)}/><span/></label></header><p className="section-kicker">{frequencyLabels[item.frequency]} · UTC {item.time_utc}{item.delivery_provider?` · 发送至${item.delivery_provider==="feishu"?"飞书":"Telegram"}`:""}</p><h3>{item.title}</h3><p>{item.description}</p><div className="schedule-route"><span>HQ-003-董秘</span><ArrowRight size={14}/><span>{item.division}</span><ArrowRight size={14}/><span>{item.assignee_name||"动态统筹"}</span></div><div className="delivery-standard"><strong>交付标准</strong>{item.output_requirements||"核心摘要 + 中文 PDF 完整报告"}</div><footer><span>下次：{new Date(item.next_run_at).toLocaleString("zh-CN")}</span>{canManage&&<button className="danger-text" onClick={()=>onDelete(item)}><Trash2 size={14}/>删除</button>}</footer></article>)}{!schedules.length&&<Empty icon={CalendarClock} title="还没有定时任务" body="建立日报、周报、风险监测或数据巡检，让董秘自动派单。"/>}</div></>;
}

function ReportsPage({ reports }: { reports: Report[] }) {
  const [selected,setSelected]=useState<Report|null>(reports[0]||null),[query,setQuery]=useState(""),[filter,setFilter]=useState<"all"|Report["decision_status"]>("all");
  useEffect(()=>{if(!selected&&reports[0])setSelected(reports[0]);},[reports,selected]);
  const visible=reports.filter(report=>(filter==="all"||report.decision_status===filter)&&`${report.title}${report.summary}${report.author}`.toLowerCase().includes(query.toLowerCase()));
  const decisionLabel:Record<Report["decision_status"],string>={informational:"供参阅",needs_decision:"待决策",approved:"已采纳",rejected:"已退回",archived:"已归档"};
  return <><section className="intel-purpose"><div><Sparkles size={21}/><div><strong>这里不是资料仓库，而是决策输入层</strong><p>统一接收事业部 CEO 的整合成果，由董秘复核后交付摘要与完整 PDF；最新事实保留来源和数据截止时间。</p></div></div><div><span>集团 CEO 统筹</span><ArrowRight/><span>事业部 CEO 整合</span><ArrowRight/><span>董秘复核</span><ArrowRight/><span>双成果交付</span></div></section><div className="report-filters"><button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>全部 {reports.length}</button><button className={filter==="needs_decision"?"active":""} onClick={()=>setFilter("needs_decision")}>待决策 {reports.filter(r=>r.decision_status==="needs_decision").length}</button><button className={filter==="informational"?"active":""} onClick={()=>setFilter("informational")}>供参阅</button></div><div className="reports-layout"><section className="report-list"><div className="report-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索结论、事业部或作者"/></div>{visible.map(report=><button className={selected?.id===report.id?"active":""} key={report.id} onClick={()=>setSelected(report)}><span className="doc-icon"><FileText size={17}/></span><div><small>{report.division} · {report.type}</small><strong>{report.title}</strong><p>{report.summary}</p><time>{report.author} · {relativeTime(report.created_at)}</time></div><em className={`decision-tag decision-${report.decision_status}`}>{decisionLabel[report.decision_status]}</em></button>)}</section><section className="report-reader">{selected?<><header><div className="reader-tags"><span>{selected.division} · {selected.type}</span><em className={`decision-tag decision-${selected.decision_status}`}>{decisionLabel[selected.decision_status]}</em><em>置信度 {selected.confidence === "high" ? "高" : selected.confidence === "low" ? "低" : "中"}</em></div><h2>{selected.title}</h2><div>{selected.author}<i/> {new Date(selected.created_at).toLocaleString("zh-CN")}{selected.task_id&&<> <i/> 可追溯任务</>}{selected.source_cutoff_at&&<> <i/> 数据截止 {new Date(selected.source_cutoff_at).toLocaleString("zh-CN")}</>}</div></header><div className="report-summary"><Sparkles size={18}/><div><strong>执行摘要</strong><p>{selected.summary}</p></div></div>{selected.pdf_url&&<a className="report-download button primary" href={selected.pdf_url} target="_blank" rel="noreferrer"><Download size={16}/>打开中文 PDF 完整方案<span>{selected.source_count} 条实时来源</span></a>}{selected.recommendation&&<div className="report-recommendation"><Target size={18}/><div><strong>建议动作</strong><p>{selected.recommendation}</p></div></div>}<article>{selected.content.replace(/\\n/g, "\n").split("\n").map((line,i)=>line.startsWith("## ")?<h3 key={i}>{line.slice(3)}</h3>:line?<p key={i}>{line}</p>:<br key={i}/>)}</article></>:<Empty icon={FileText} title="暂无报告" body="事业部成果会进入董秘复核，并沉淀在这里。"/>}</section></div></>;
}

function FinancePage({ agents, routing }: { agents: Agent[]; routing: AiRouting | null }) {
  const used=agents.reduce((sum,agent)=>sum+agent.monthly_tokens_used,0), input=agents.reduce((sum,agent)=>sum+agent.monthly_input_tokens,0), output=agents.reduce((sum,agent)=>sum+agent.monthly_output_tokens,0);
  const today=new Date(), daysInMonth=new Date(today.getFullYear(),today.getMonth()+1,0).getDate(), projected=Math.round(used/Math.max(1,today.getDate())*daysInMonth);
  const byDivision=Array.from(new Set(agents.map(agent=>agent.division))).map(division=>({name:division,used:agents.filter(agent=>agent.division===division).reduce((sum,agent)=>sum+agent.monthly_tokens_used,0)}));
  const largestDivision=Math.max(0,...byDivision.map(division=>division.used));
  const neuronProgress=routing?Math.min(100,routing.dailyNeuronsUsed/routing.dailyNeuronAllocation*100):0;
  return <div className="finance-grid">
    <section className="panel finance-hero"><p className="section-kicker">本月 Token 用量</p><div><strong>{formatTokens(used)}</strong><span>输入 {formatTokens(input)} · 输出 {formatTokens(output)}</span></div><div className="token-usage-note">所有模型统一按 Token 记录，BitWorld 不设置 DeepSeek 配额或限额。</div><footer><span><TrendingUp size={15}/>按本月进度预计 {formatTokens(projected)}</span><span className="positive">持续记录</span></footer></section>
    <section className="panel neuron-card"><PanelTitle icon={Zap} eyebrow="Cloudflare Workers AI" title="今日免费资源消耗"/>{routing?<><div className="neuron-total"><strong>{formatNeurons(routing.dailyNeuronsUsed)}</strong><span>今日估算用量</span></div><div className="neuron-progress"><i style={{width:`${neuronProgress}%`}}/></div><div className="neuron-meta"><span>剩余约 {formatNeurons(routing.dailyNeuronsRemaining)}</span><span>每日参考量 {formatNeurons(routing.dailyNeuronAllocation)}</span></div><p>Neurons 为按官方模型单价换算的估算值，UTC 00:00 重置；最终用量以 Cloudflare 后台为准。</p></>:<Empty icon={Zap} title="正在读取 Cloudflare 用量" body="路由统计加载后会显示今日 Neurons。"/>}</section>
    <section className="panel full-span"><PanelTitle icon={BarChart3} eyebrow="事业部分布" title="事业部 Token 用量"/><div className="division-budget division-budget-wide">{byDivision.map(division=><div key={division.name}><span>{division.name}<b>{formatTokens(division.used)}</b></span><i><em style={{width:`${largestDivision?division.used/largestDivision*100:0}%`}}/></i><small>占公司总用量 {used?Math.round(division.used/used*100):0}%</small></div>)}</div></section>
    <section className="panel full-span"><PanelTitle icon={Bot} eyebrow="智能体资源使用" title="Agent Token 与 Neurons 明细"/><div className="data-table token-table"><div className="data-head"><span>Agent</span><span>事业部</span><span>岗位模型</span><span>输入 / 输出</span><span>Token / Cloudflare Neurons</span><span>Token 占比</span></div>{[...agents].sort((left,right)=>right.monthly_tokens_used-left.monthly_tokens_used).map(agent=><div key={agent.id}><span><AgentAvatar agent={agent}/><strong>{agent.name}</strong></span><span>{agent.division}</span><span className="mono">{agent.model}</span><span>{formatTokens(agent.monthly_input_tokens)} / {formatTokens(agent.monthly_output_tokens)}</span><span className="usage-cell"><strong>{formatTokens(agent.monthly_tokens_used)}</strong><small>{formatNeurons(agent.monthly_neurons_used)}</small></span><span>{used?Math.round(agent.monthly_tokens_used/used*100):0}%</span></div>)}</div></section>
  </div>;
}

function GovernancePage({ approvals, activity, onDecision }: { approvals: Approval[]; activity: Activity[]; onDecision: (id:string,decision:"approved"|"rejected")=>void }) {
  return <div className="governance-grid"><section className="panel"><PanelTitle icon={ClipboardCheck} eyebrow="经营决策" title="待审批事项"/><div className="approval-list">{approvals.filter(a=>a.status==="pending").map(a=><article key={a.id}><header><span className={`risk risk-${a.risk}`}>{riskLabels[a.risk]}</span><small>{approvalTypeLabels[a.type] ?? a.type}</small></header><h3>{a.title}</h3><p>{a.rationale}</p><footer><span>{a.requested_by} · {relativeTime(a.created_at)}</span><div><button className="decision reject" onClick={()=>onDecision(a.id,"rejected")}><XCircle size={15}/>拒绝</button><button className="decision approve" onClick={()=>onDecision(a.id,"approved")}><Check size={15}/>批准</button></div></footer></article>)}{!approvals.some(a=>a.status==="pending")&&<Empty icon={CheckCircle2} title="决策箱已清空" body="当前没有等待你批准的高风险动作。"/>}</div></section><section className="panel"><PanelTitle icon={ActivityIcon} eyebrow="审计轨迹" title="最近活动"/><div className="timeline">{activity.map(item=><div key={item.id}><span className="timeline-dot"/><div><strong>{item.summary}</strong><p>{item.actor} · {relativeTime(item.created_at)}</p></div></div>)}</div></section></div>;
}

const notificationProviders: Array<{ provider: NotificationProvider; name: string; description: string; icon: typeof Send }> = [
  { provider: "telegram", name: "Telegram", description: "支持经营通知，也可直接与 BitWorld 董秘对话。", icon: Send },
  { provider: "feishu", name: "飞书", description: "企业自建应用支持通知与董秘双向对话，群 Webhook 仅支持通知。", icon: MessageCircle },
  { provider: "wecom", name: "企业微信", description: "通过企业微信群机器人 Webhook 接收经营提醒。", icon: Users },
];

const notificationEvents: Array<{ value: NotificationEvent; label: string }> = [
  { value: "task_completed", label: "任务完成" },
  { value: "report_published", label: "报告发布" },
  { value: "run_failed", label: "运行失败" },
  { value: "approval_decided", label: "审批结果" },
];

const notificationEventLabels = Object.fromEntries(notificationEvents.map((item) => [item.value, item.label])) as Record<NotificationEvent, string>;

function NotificationChannelCard({ provider, channel, onChanged }: { provider: NotificationProvider; channel?: NotificationChannel; onChanged: () => Promise<void> }) {
  const meta = notificationProviders.find((item) => item.provider === provider)!;
  const Icon = meta.icon;
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [events, setEvents] = useState<NotificationEvent[]>(channel?.events.length ? channel.events : notificationEvents.map((item) => item.value));
  const [config, setConfig] = useState<Record<string, string>>({});
  const [feishuMode, setFeishuMode] = useState<"webhook" | "app">(channel?.configMode === "app" ? "app" : "webhook");
  const [busy, setBusy] = useState<"save" | "test" | "inbound" | "delete" | "">("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    setEnabled(channel?.enabled ?? true);
    setEvents(channel?.events.length ? channel.events : notificationEvents.map((item) => item.value));
    setFeishuMode(channel?.configMode === "app" ? "app" : "webhook");
  }, [channel]);

  function updateConfig(key: string, value: string) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function toggleEvent(event: NotificationEvent) {
    setEvents((current) => current.includes(event) ? current.filter((item) => item !== event) : [...current, event]);
  }

  async function save() {
    setBusy("save"); setMessage(null);
    try {
      await api.saveNotification(provider, { enabled, events, config, ...(provider === "feishu" ? { mode: feishuMode } : {}) });
      setConfig({});
      setMessage({ type: "success", text: "配置已加密保存" });
      await onChanged();
    } catch (caught) {
      setMessage({ type: "error", text: caught instanceof Error ? caught.message : "保存失败" });
    } finally { setBusy(""); }
  }

  async function test() {
    setBusy("test"); setMessage(null);
    try {
      await api.testNotification(provider);
      setMessage({ type: "success", text: "测试消息发送成功，请检查对应会话" });
      await onChanged();
    } catch (caught) {
      setMessage({ type: "error", text: caught instanceof Error ? caught.message : "测试失败" });
      await onChanged();
    } finally { setBusy(""); }
  }

  async function enableInbound() {
    setBusy("inbound"); setMessage(null);
    try {
      await api.enableTelegramInbound();
      setMessage({ type: "success", text: "Telegram 双向回复已启用，现在可以直接给 BitWorld 董秘发消息" });
      await onChanged();
    } catch (caught) {
      setMessage({ type: "error", text: caught instanceof Error ? caught.message : "双向回复启用失败" });
    } finally { setBusy(""); }
  }

  async function remove() {
    if (!window.confirm(`确定删除 ${meta.name} 通知配置？删除后已保存的凭据无法恢复。`)) return;
    setBusy("delete"); setMessage(null);
    try {
      await api.deleteNotification(provider);
      setConfig({});
      setMessage({ type: "success", text: "渠道配置已删除" });
      await onChanged();
    } catch (caught) {
      setMessage({ type: "error", text: caught instanceof Error ? caught.message : "删除失败" });
    } finally { setBusy(""); }
  }

  const placeholder = channel?.configured ? "已加密保存，留空保持不变" : undefined;
  return <article className={`notification-channel ${channel?.enabled ? "is-enabled" : ""}`}>
    <header>
      <div className={`channel-logo ${provider}`}><Icon size={19}/></div>
      <div><h3>{meta.name}</h3><p>{meta.description}</p></div>
      <label className="switch"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)}/><span/></label>
    </header>
    <div className="channel-form">
      {provider === "telegram" ? <>
        <label>Bot Token<input type="password" value={config.botToken ?? ""} onChange={(event) => updateConfig("botToken", event.target.value)} placeholder={placeholder ?? "123456789:AA..."}/></label>
        <div className="channel-form-row"><label>Chat ID<input value={config.chatId ?? ""} onChange={(event) => updateConfig("chatId", event.target.value)} placeholder={placeholder ?? "-1001234567890"}/></label><label>话题 ID（可选）<input inputMode="numeric" value={config.topicId ?? ""} onChange={(event) => updateConfig("topicId", event.target.value)} placeholder="群话题 ID"/></label></div>
      </> : provider === "feishu" ? <>
        <label>接入方式<select value={feishuMode} onChange={(event) => { setFeishuMode(event.target.value as "webhook" | "app"); setConfig({}); }}><option value="app">企业自建应用机器人（推荐）</option><option value="webhook">群自定义机器人 Webhook</option></select></label>
        {feishuMode === "app" ? <>
          <label>App ID<input value={config.appId ?? ""} onChange={(event) => updateConfig("appId", event.target.value)} placeholder={placeholder ?? "cli_xxxxxxxxxxxxxxxx"}/></label>
          <label>App Secret<input type="password" value={config.appSecret ?? ""} onChange={(event) => updateConfig("appSecret", event.target.value)} placeholder={placeholder ?? "飞书开发者后台的 App Secret"}/></label>
          <div className="channel-form-row"><label>接收用户 ID<input value={config.receiveId ?? ""} onChange={(event) => { updateConfig("receiveId", event.target.value); updateConfig("receiveIdType", "user_id"); }} placeholder={placeholder ?? "飞书组织内用户 ID"}/></label><label>接收类型<input value="组织内用户" disabled/></label></div>
          <label>事件订阅 Verification Token<input type="password" value={config.verificationToken ?? ""} onChange={(event) => updateConfig("verificationToken", event.target.value)} placeholder={placeholder ?? "飞书事件订阅页面的 Verification Token"}/></label>
        </> : <>
          <label>群机器人 Webhook<input type="password" value={config.webhookUrl ?? ""} onChange={(event) => updateConfig("webhookUrl", event.target.value)} placeholder={placeholder ?? "https://open.feishu.cn/open-apis/bot/v2/hook/..."}/></label>
          <label>签名密钥（可选）<input type="password" value={config.secret ?? ""} onChange={(event) => updateConfig("secret", event.target.value)} placeholder={placeholder ?? "飞书机器人安全设置中的签名密钥"}/></label>
        </>}
      </> : <>
        <label>群机器人 Webhook<input type="password" value={config.webhookUrl ?? ""} onChange={(event) => updateConfig("webhookUrl", event.target.value)} placeholder={placeholder ?? "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."}/></label>
      </>}
    </div>
    {channel?.callbackPath && (provider === "telegram" || (provider === "feishu" && feishuMode === "app")) && <div className="channel-form callback-field">
      <label>董秘消息回调地址<input readOnly value={channel.callbackUrl?.startsWith("http") ? channel.callbackUrl : `${window.location.origin}${channel.callbackUrl ?? channel.callbackPath}`} onFocus={(event) => event.currentTarget.select()}/></label>
    </div>}
    <div className="event-picker"><strong>自动通知事件</strong><div>{notificationEvents.map((item) => <label key={item.value}><input type="checkbox" checked={events.includes(item.value)} onChange={() => toggleEvent(item.value)}/><span>{item.label}</span></label>)}</div></div>
    {channel?.configured && <div className="channel-status"><span className="signal-dot"/>{channel.configSummary}{channel.lastTestAt && <small>最近测试：{channel.lastTestStatus === "success" ? "成功" : "失败"} · {relativeTime(channel.lastTestAt)}</small>}</div>}
    {channel?.configured && (provider === "telegram" || (provider === "feishu" && channel.configMode === "app")) && <div className="channel-status"><span className="signal-dot"/>{channel.inboundConfigured ? "董秘双向回复已配置" : provider === "telegram" ? "董秘双向回复尚未启用" : "保存 Verification Token 后，可在飞书开放平台登记上方回调地址"}</div>}
    {(message || channel?.lastError) && <div className={`channel-message ${message?.type ?? "error"}`}>{message?.text ?? channel?.lastError}</div>}
    <footer>
      {channel?.configured && <button className="button subtle danger-text" disabled={Boolean(busy)} onClick={() => void remove()}>{busy === "delete" ? <LoaderCircle className="spin" size={15}/> : <Trash2 size={15}/>}删除</button>}
      {provider === "telegram" && channel?.configured && <button className="button subtle" disabled={Boolean(busy)} onClick={() => void enableInbound()}>{busy === "inbound" ? <LoaderCircle className="spin" size={15}/> : <MessageCircle size={15}/>}启用双向回复</button>}
      <button className="button subtle" disabled={!channel?.configured || Boolean(busy)} onClick={() => void test()}>{busy === "test" ? <LoaderCircle className="spin" size={15}/> : <Radio size={15}/>}测试连接</button>
      <button className="button primary" disabled={!events.length || Boolean(busy)} onClick={() => void save()}>{busy === "save" ? <LoaderCircle className="spin" size={15}/> : <Check size={15}/>}保存配置</button>
    </footer>
  </article>;
}

function NotificationCenter({ user }: { user: AuthUser }) {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const result = await api.notifications();
      setChannels(result.channels); setDeliveries(result.deliveries); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "通知设置加载失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section className="panel notification-center full-span">
    <PanelTitle icon={BellRing} eyebrow="消息触达" title="通知中心"/>
    <div className="notification-intro"><div><strong>让关键经营事件主动找到你</strong><p>当前配置仅属于 <b>{user.email}</b>。每个 BitWorld 账号分别保存自己的 Telegram、飞书与企业微信渠道，账号之间不可查看或修改彼此凭据。</p></div><span><ShieldCheck size={15}/>凭据已加密且按账号隔离</span></div>
    {error && <div className="form-error"><AlertTriangle size={16}/>{error}</div>}
    {loading ? <div className="notification-loading"><LoaderCircle className="spin"/><span>正在读取通知配置…</span></div> : <div className="notification-grid">{notificationProviders.map((item) => <NotificationChannelCard key={item.provider} provider={item.provider} channel={channels.find((channel) => channel.provider === item.provider)} onChanged={load}/>)}</div>}
    {deliveries.length > 0 && <div className="delivery-history"><header><strong>最近投递</strong><span>只记录结果，不记录凭据或完整消息正文</span></header><div>{deliveries.slice(0, 8).map((item) => <article key={item.id}><span className={`delivery-dot ${item.status}`}/><div><strong>{item.name} · {notificationEventLabels[item.event_type]}</strong><p>{item.title}</p></div><StatusPill value={item.status === "success" ? "succeeded" : "failed"}/><time>{relativeTime(item.created_at)}</time></article>)}</div></div>}
  </section>;
}

function SettingsPage({ user, routing, onRoutingChange }: { user: AuthUser; routing: AiRouting | null; onRoutingChange: (enabled: boolean) => Promise<void> }) {
  const [accounts, setAccounts] = useState<AccountUser[]>([]);
  const [accountError, setAccountError] = useState("");
  const [routingBusy, setRoutingBusy] = useState(false);
  const loadAccounts = useCallback(async () => {
    if (user.role !== "owner") return;
    try { setAccounts((await api.users()).items); }
    catch (caught) { setAccountError(caught instanceof Error ? caught.message : "账号加载失败"); }
  }, [user.role]);
  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  async function changeStatus(id: string, status: "active" | "disabled") {
    try { await api.updateUser(id, status); await loadAccounts(); }
    catch (caught) { setAccountError(caught instanceof Error ? caught.message : "账号更新失败"); }
  }
  return <div className="settings-grid">
    <section className="panel setting-card"><div className="setting-icon green"><CheckCircle2/></div><div><p className="section-kicker">部署状态</p><h3>Cloudflare Workers</h3><p>静态资源与接口已部署到全球边缘网络，使用免费的 workers.dev 域名。</p></div><StatusPill value="active"/></section>
    <section className="panel setting-card"><div className="setting-icon"><Gauge/></div><div><p className="section-kicker">数据存储</p><h3>Cloudflare D1</h3><p>公司、任务、Agent、报告、账号与审计数据使用原生 SQL 绑定。</p></div><StatusPill value="active"/></section>
    <section className="panel setting-card"><div className="setting-icon"><ActivityIcon/></div><div><p className="section-kicker">异步执行</p><h3>Cloudflare Queues</h3><p>Agent 运行与网页请求解耦，失败自动重试并写入运行记录。</p></div><StatusPill value="active"/></section>
    <section className="panel setting-card"><div className="setting-icon model"><Bot/></div><div><p className="section-kicker">模型路由</p><h3>DeepSeek + Cloudflare 混合调度</h3><p>岗位模型决定能力层级，供应商路由负责优先利用免费资源并自动容灾。</p></div><StatusPill value="active"/></section>
    <section className="panel setting-card"><div className="setting-icon amber"><ShieldCheck/></div><div><p className="section-kicker">安全访问</p><h3>账号与会话保护</h3><p>支持邮箱账号与 Google 登录，密码安全派生，会话令牌仅以摘要形式保存。</p></div><StatusPill value="active"/></section>
    <section className="panel ai-routing-panel full-span">
      <div className="ai-routing-head"><div><p className="section-kicker">智能模型调度</p><h3>混合模型路由</h3><p>统筹岗位保持 DeepSeek V4 Pro；基础执行岗位可优先使用 Cloudflare 免费额度，异常或达到软阈值后自动回退。</p></div><label className="route-toggle"><span>优先使用 Cloudflare 免费额度</span><input type="checkbox" checked={routing?.preferCloudflareFree ?? false} disabled={user.role!=="owner"||routingBusy||!routing} onChange={async(event)=>{setRoutingBusy(true);try{await onRoutingChange(event.target.checked);}finally{setRoutingBusy(false);}}}/><i/></label></div>
      <div className="route-lanes">
        <div><span className="route-role pro">统筹规划</span><strong>DeepSeek V4 Pro</strong><ArrowRight/><em>失败时</em><ArrowRight/><strong>Cloudflare GLM-4.7-Flash</strong></div>
        <div><span className="route-role flash">基础执行</span><strong>{routing?.preferCloudflareFree?"Cloudflare GLM-4.7-Flash":"DeepSeek V4 Flash"}</strong><ArrowRight/><em>失败或额度临界</em><ArrowRight/><strong>{routing?.preferCloudflareFree?"DeepSeek V4 Flash":"Cloudflare GLM-4.7-Flash"}</strong></div>
      </div>
      {routing&&<div className="route-usage"><div><span>当前账号今日 Cloudflare 估算用量</span><strong>{formatNeurons(routing.dailyNeuronsUsed)}</strong></div><i><em style={{width:`${Math.min(100,routing.platformDailyNeuronsUsed/routing.dailyNeuronAllocation*100)}%`}}/></i><p>平台共享用量达到 {formatNeurons(routing.dailyNeuronSoftLimit)} 后，当天自动回退 DeepSeek；UTC 00:00 重置。</p></div>}
    </section>
    <NotificationCenter user={user}/>
    {user.role === "owner" && <section className="panel account-card full-span"><PanelTitle icon={Users} eyebrow="账号权限" title="成员账号"/>{accountError && <div className="form-error"><AlertTriangle size={16}/>{accountError}</div>}<div className="account-list">{accounts.map(account => <div key={account.id}><div className="account-avatar">{account.displayName.slice(0,2)}</div><div><strong>{account.displayName}{account.id === user.id && <small>当前账号</small>}</strong><p>{account.email} · {account.role === "owner" ? "所有者" : "成员"}</p></div><StatusPill value={account.status}/>{account.id !== user.id && <div className="account-actions">{account.status === "pending" && <button className="decision approve" onClick={() => void changeStatus(account.id, "active")}><Check size={15}/>批准</button>}{account.status === "active" && <button className="decision reject" onClick={() => void changeStatus(account.id, "disabled")}><XCircle size={15}/>停用</button>}{account.status === "disabled" && <button className="decision approve" onClick={() => void changeStatus(account.id, "active")}><Check size={15}/>启用</button>}</div>}</div>)}</div></section>}
    <section className="panel architecture-card full-span"><PanelTitle icon={Network} eyebrow="系统架构" title="系统边界"/><div className="architecture-flow"><div><strong>前端界面</strong><small>全球静态资源</small></div><ArrowRight/><div><strong>边缘接口</strong><small>认证与业务逻辑</small></div><ArrowRight/><div><strong>数据库与队列</strong><small>状态与异步执行</small></div><ArrowRight/><div><strong>模型服务</strong><small>智能推理</small></div></div><p>Cloudflare 版本独立运行，后续可分阶段迁移高级插件与更多自动化。</p></section>
  </div>;
}

function AgentModal({ onClose, onCreate }: { onClose: () => void; onCreate: (input: { name: string; title: string; division: string }) => void }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [division, setDivision] = useState("总部");
  const planningRole = /CEO|首席|负责人|董事会秘书|主编|策略分析师|新闻分析师|舆情分析师|风险控制|风控|战略|规划|统筹|决策|架构|主管|总监/i.test(`${name} ${title}`);
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={(event)=>event.stopPropagation()} onSubmit={(event)=>{event.preventDefault();onCreate({name:name.trim(),title:title.trim(),division:division.trim()});}}><header><div><p className="section-kicker">扩充 AI 团队</p><h2>添加 Agent</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={20}/></button></header><label>Agent 名称<input required value={name} onChange={(event)=>setName(event.target.value)} placeholder="例如 Research-005-洞察"/></label><label>岗位职责<input required value={title} onChange={(event)=>setTitle(event.target.value)} placeholder="例如 用户洞察分析师"/></label><label>所属事业部<input required value={division} onChange={(event)=>setDivision(event.target.value)} placeholder="总部"/></label><div className={`model-policy-preview ${planningRole?"pro":"flash"}`}><Sparkles size={17}/><div><strong>将自动分配 {planningRole?"DeepSeek V4 Pro":"DeepSeek V4 Flash"}</strong><p>{planningRole?"检测到统筹、规划或高判断职责。":"执行型或未识别岗位默认使用低成本 Flash；可通过明确职责词升级。"}</p></div></div><footer><button type="button" className="button subtle" onClick={onClose}>取消</button><button className="button primary" disabled={!name.trim()||!title.trim()||!division.trim()}><Plus size={16}/>创建 Agent</button></footer></form></div>;
}

function TaskModal({ agents, onClose, onCreate }: { agents: Agent[]; onClose:()=>void; onCreate:(input:Partial<Task>)=>void }) {
  const [title,setTitle]=useState(""),[description,setDescription]=useState(""),[requirements,setRequirements]=useState("输出核心结论、关键依据、主要风险、行动建议及需总部决策事项"),[agent,setAgent]=useState(""),[priority,setPriority]=useState<Task["priority"]>("medium");
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();onCreate({title,description,output_requirements:requirements,source:"secretary",requested_by:"HQ-003-董秘",workflow_stage:"division_execution",assignee_agent_id:agent||null,priority,status:"todo",division:agents.find(a=>a.id===agent)?.division||"总部"});}}><header><div><p className="section-kicker">总部 → 事业部</p><h2>董秘派单</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={20}/></button></header><div className="modal-context"><ShieldCheck size={17}/><span>董秘将任务分派给事业部，成果完成后自动回到董秘复核。</span></div><label>任务名称<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder="明确描述需要交付的结果"/></label><label>任务背景<textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="为什么做、已知信息和重要约束"/></label><label>交付标准<textarea value={requirements} onChange={e=>setRequirements(e.target.value)} placeholder="定义成果结构、质量标准与需回答的问题"/></label><div className="form-row"><label>承接事业部 / Agent<select value={agent} onChange={e=>setAgent(e.target.value)}><option value="">暂不分配</option>{agents.map(a=><option key={a.id} value={a.id}>{a.division} · {a.name} · {a.title}</option>)}</select></label><label>优先级<select value={priority} onChange={e=>setPriority(e.target.value as Task["priority"])}><option value="urgent">紧急</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label></div><footer><button type="button" className="button subtle" onClick={onClose}>取消</button><button className="button primary" disabled={!title.trim()}><Send size={16}/>确认派单</button></footer></form></div>;
}

function ScheduleModal({ agents, onClose, onCreate }: { agents: Agent[]; onClose:()=>void; onCreate:(input:Partial<ScheduledTask>)=>void }) {
  const [title,setTitle]=useState(""),[description,setDescription]=useState(""),[requirements,setRequirements]=useState(""),[agent,setAgent]=useState(""),[frequency,setFrequency]=useState<ScheduledTask["frequency"]>("daily"),[time,setTime]=useState("01:00"),[provider,setProvider]=useState<"feishu"|"telegram">("feishu");
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onMouseDown={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();const target=agents.find(a=>a.id===agent);onCreate({title,description,output_requirements:requirements,assignee_agent_id:agent||null,division:target?.division||"总部",frequency,time_utc:time,delivery_provider:provider,priority:"medium"});}}><header><div><p className="section-kicker">自动经营节奏</p><h2>新建定时任务</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={20}/></button></header><label>任务名称<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如 每日 AI 行业简报"/></label><label>任务说明<textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="需要持续监测或产出的内容"/></label><label>交付标准<textarea value={requirements} onChange={e=>setRequirements(e.target.value)} placeholder="数量、结构、信源、判断与建议要求"/></label><div className="form-row"><label>执行 Agent<select required value={agent} onChange={e=>setAgent(e.target.value)}><option value="">请选择</option>{agents.map(a=><option key={a.id} value={a.id}>{a.division} · {a.name}</option>)}</select></label><label>频率<select value={frequency} onChange={e=>setFrequency(e.target.value as ScheduledTask["frequency"])}>{Object.entries(frequencyLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label></div><div className="form-row"><label>执行时间（UTC）<input type="time" value={time} onChange={e=>setTime(e.target.value)}/><small>新加坡时间 = UTC + 8，例如 UTC 01:00 对应新加坡 09:00。</small></label><label>发送渠道<select value={provider} onChange={e=>setProvider(e.target.value as "feishu"|"telegram")}><option value="feishu">飞书</option><option value="telegram">Telegram</option></select></label></div><footer><button type="button" className="button subtle" onClick={onClose}>取消</button><button className="button primary" disabled={!title.trim()||!agent}><CalendarClock size={16}/>启用任务</button></footer></form></div>;
}

function AgentRuntimeModal({ agent, onClose, onSave }: { agent: Agent; onClose:()=>void; onSave:(input:Partial<Agent>)=>void }) {
  const [systemPrompt,setSystemPrompt]=useState(agent.system_prompt),[temperature,setTemperature]=useState(agent.temperature),[reasoning,setReasoning]=useState(agent.reasoning_mode),[maxTokens,setMaxTokens]=useState(agent.max_output_tokens),[timeout,setTimeoutValue]=useState(agent.execution_timeout_sec),[retries,setRetries]=useState(agent.max_retries),[toolPolicy,setToolPolicy]=useState(agent.tool_policy),[memoryPolicy,setMemoryPolicy]=useState(agent.memory_policy);
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal runtime-modal" onMouseDown={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();onSave({system_prompt:systemPrompt,temperature,reasoning_mode:reasoning,max_output_tokens:maxTokens,execution_timeout_sec:timeout,max_retries:retries,tool_policy:toolPolicy,memory_policy:memoryPolicy});}}><header><div><p className="section-kicker">Agent 底层运行机制</p><h2>{agent.name}</h2><span>{agent.division} · {agent.title}</span></div><button type="button" className="icon-button" onClick={onClose}><X size={20}/></button></header><div className="model-lock"><Sparkles size={17}/><div><strong>{agent.model === "deepseek-v4-pro" ? "DeepSeek V4 Pro · 统筹规划" : "DeepSeek V4 Flash · 基础执行"}</strong><p>模型继续遵循岗位分层规则；这里调整该 Agent 的推理与执行边界。</p></div></div><label>专属系统指令<textarea value={systemPrompt} onChange={e=>setSystemPrompt(e.target.value)} placeholder="补充岗位原则、专业框架或输出禁区；留空使用公司默认指令"/></label><div className="form-row"><label>推理模式<select value={reasoning} onChange={e=>setReasoning(e.target.value as Agent["reasoning_mode"])}><option value="auto">自动</option><option value="high">增强推理</option><option value="off">关闭推理</option></select></label><label>记忆范围<select value={memoryPolicy} onChange={e=>setMemoryPolicy(e.target.value as Agent["memory_policy"])}><option value="none">不使用记忆</option><option value="task">仅当前任务</option><option value="division">事业部上下文</option></select></label></div><div className="form-row"><label>温度（0–1.5）<input type="number" min="0" max="1.5" step="0.1" value={temperature} onChange={e=>setTemperature(Number(e.target.value))}/></label><label>最大输出 Token<input type="number" min="256" max="8000" step="256" value={maxTokens} onChange={e=>setMaxTokens(Number(e.target.value))}/></label></div><div className="form-row"><label>执行超时（秒）<input type="number" min="15" max="300" value={timeout} onChange={e=>setTimeoutValue(Number(e.target.value))}/></label><label>失败重试次数<input type="number" min="0" max="5" value={retries} onChange={e=>setRetries(Number(e.target.value))}/></label></div><label>工具权限<select value={toolPolicy} onChange={e=>setToolPolicy(e.target.value as Agent["tool_policy"])}><option value="readonly">只读</option><option value="standard">标准执行</option><option value="elevated">高级操作</option></select></label><footer><button type="button" className="button subtle" onClick={onClose}>取消</button><button className="button primary"><Check size={16}/>保存运行机制</button></footer></form></div>;
}

export default function App() {
  const [authenticated,setAuthenticated]=useState<boolean|null>(null),[page,setPage]=useState<Page>("dashboard"),[dashboard,setDashboard]=useState<Dashboard|null>(null);
  const [currentUser,setCurrentUser]=useState<AuthUser|null>(null),[googleConfigured,setGoogleConfigured]=useState(false),[emailConfigured,setEmailConfigured]=useState(false);
  const [account,setAccount]=useState<AccountState|null>(null);
  const [aiRouting,setAiRouting]=useState<AiRouting|null>(null);
  const [agents,setAgents]=useState<Agent[]>([]),[tasks,setTasks]=useState<Task[]>([]),[schedules,setSchedules]=useState<ScheduledTask[]>([]),[goals,setGoals]=useState<Goal[]>([]),[reports,setReports]=useState<Report[]>([]),[approvals,setApprovals]=useState<Approval[]>([]),[activity,setActivity]=useState<Activity[]>([]);
  const [refreshing,setRefreshing]=useState(false),[error,setError]=useState(""),[modal,setModal]=useState(false),[agentModal,setAgentModal]=useState(false),[scheduleModal,setScheduleModal]=useState(false),[runtimeAgent,setRuntimeAgent]=useState<Agent|null>(null);
  const refreshSession=useCallback(()=>api.session().then(x=>{setAuthenticated(x.authenticated);setCurrentUser(x.user);setGoogleConfigured(x.googleConfigured);setEmailConfigured(x.emailConfigured);}).catch(()=>{setAuthenticated(false);setCurrentUser(null);}),[]);
  useEffect(()=>{void refreshSession();},[refreshSession]);
  const load=useCallback(async()=>{if(!authenticated)return;setRefreshing(true);setError("");try{const [accountState,d,route,a,t,s,g,r,ap,ac]=await Promise.all([api.account(),api.dashboard(),api.aiRouting(),api.agents(),api.tasks(),api.schedules(),api.goals(),api.reports(),api.approvals(),api.activity()]);setAccount(accountState);setDashboard(d);setAiRouting(route);setAgents(a.items);setTasks(t.items);setSchedules(s.items);setGoals(g.items);setReports(r.items);setApprovals(ap.items);setActivity(ac.items);}catch(err){const message=err instanceof Error?err.message:"加载失败";if(message.includes("未登录")){setAuthenticated(false);}else setError(message);}finally{setRefreshing(false);}},[authenticated]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{if(!authenticated)return;const timer=setInterval(()=>void load(),30000);return()=>clearInterval(timer);},[authenticated,load]);
  async function updateTask(id:string,input:Partial<Task>){try{await api.updateTask(id,input);await load();}catch(e){setError(e instanceof Error?e.message:"更新失败");}}
  async function createTask(input:Partial<Task>){try{await api.createTask(input);setModal(false);await load();}catch(e){setError(e instanceof Error?e.message:"创建失败");}}
  async function runTask(task:Task){try{await api.runTask(task.id,task.assignee_agent_id);await load();}catch(e){setError(e instanceof Error?e.message:"启动失败");}}
  async function updateAgent(id:string,status:Agent["status"]){try{await api.updateAgent(id,status);await load();}catch(e){setError(e instanceof Error?e.message:"更新失败");}}
  async function createAgent(input:{name:string;title:string;division:string}){try{await api.createAgent(input);setAgentModal(false);await load();}catch(e){setError(e instanceof Error?e.message:"Agent 创建失败");}}
  async function saveRuntime(input:Partial<Agent>){if(!runtimeAgent)return;try{await api.updateAgentRuntime(runtimeAgent.id,input);setRuntimeAgent(null);await load();}catch(e){setError(e instanceof Error?e.message:"运行机制保存失败");}}
  async function createSchedule(input:Partial<ScheduledTask>){try{await api.createSchedule(input);setScheduleModal(false);await load();}catch(e){setError(e instanceof Error?e.message:"定时任务创建失败");}}
  async function toggleSchedule(item:ScheduledTask){try{await api.updateSchedule(item.id,{enabled:!item.enabled});await load();}catch(e){setError(e instanceof Error?e.message:"定时任务更新失败");}}
  async function deleteSchedule(item:ScheduledTask){if(!window.confirm(`确定删除“${item.title}”？`))return;try{await api.deleteSchedule(item.id);await load();}catch(e){setError(e instanceof Error?e.message:"定时任务删除失败");}}
  async function decide(id:string,decision:"approved"|"rejected"){try{await api.decideApproval(id,decision);await load();}catch(e){setError(e instanceof Error?e.message:"审批失败");}}
  async function updateAiRouting(preferCloudflareFree:boolean){try{setAiRouting(await api.updateAiRouting(preferCloudflareFree));}catch(e){setError(e instanceof Error?e.message:"AI 路由更新失败");throw e;}}
  async function dismissOnboarding(){try{setAccount(await api.updateAccount({onboardingCompleted:true}));}catch(e){setError(e instanceof Error?e.message:"新手引导更新失败");}}
  if(authenticated===null)return <div className="boot"><div className="brand-symbol"><span/><span/><span/></div><LoaderCircle className="spin"/></div>;
  if(!authenticated||!currentUser)return <Login googleConfigured={googleConfigured} emailConfigured={emailConfigured} onSuccess={()=>void refreshSession()}/>;
  return <Shell page={page} setPage={setPage} user={currentUser} onRefresh={()=>void load()} refreshing={refreshing} onLogout={async()=>{await api.logout();setAuthenticated(false);setCurrentUser(null);}}>
    {error&&<div className="global-error"><AlertTriangle size={17}/><span>{error}</span><button onClick={()=>setError("")}><X size={16}/></button></div>}
    {!dashboard&&refreshing?<div className="page-loading"><LoaderCircle className="spin"/><span>正在同步公司状态…</span></div>:<>
      {page==="dashboard"&&account&&<OnboardingBanner account={account} go={setPage} onDismiss={()=>void dismissOnboarding()}/>}
      {page==="dashboard"&&dashboard&&<DashboardPage data={dashboard} go={setPage}/>}
      {page==="tasks"&&<><TaskBoard tasks={tasks} agents={agents} onCreate={()=>setModal(true)} onUpdate={updateTask} onRun={runTask}/><section className="panel runs-section"><PanelTitle icon={ActivityIcon} eyebrow="运行历史" title="Agent 运行记录"/><RunTable runs={dashboard?.runs||[]}/></section></>}
      {page==="schedules"&&<SchedulesPage schedules={schedules} canManage onCreate={()=>setScheduleModal(true)} onToggle={toggleSchedule} onDelete={deleteSchedule}/>}
      {page==="agents"&&<AgentsPage agents={agents} canCreate={currentUser.role==="owner"} onCreate={()=>setAgentModal(true)} onUpdate={updateAgent} onConfigure={setRuntimeAgent}/>}
      {page==="goals"&&<GoalsPage goals={goals}/>}
      {page==="reports"&&<ReportsPage reports={reports}/>}
      {page==="finance"&&<FinancePage agents={agents} routing={aiRouting}/>}
      {page==="governance"&&<GovernancePage approvals={approvals} activity={activity} onDecision={decide}/>}
      {page==="settings"&&<SettingsPage user={currentUser} routing={aiRouting} onRoutingChange={updateAiRouting}/>}
    </>}
    {modal&&<TaskModal agents={agents} onClose={()=>setModal(false)} onCreate={createTask}/>}
    {agentModal&&<AgentModal onClose={()=>setAgentModal(false)} onCreate={createAgent}/>}
    {scheduleModal&&<ScheduleModal agents={agents} onClose={()=>setScheduleModal(false)} onCreate={createSchedule}/>}
    {runtimeAgent&&<AgentRuntimeModal agent={runtimeAgent} onClose={()=>setRuntimeAgent(null)} onSave={saveRuntime}/>}
  </Shell>;
}
