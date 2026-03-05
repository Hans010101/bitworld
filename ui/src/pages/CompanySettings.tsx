import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { companiesApi } from "../api/companies";
import { accessApi } from "../api/access";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Settings, Check, Copy } from "lucide-react";
import { CompanyPatternIcon } from "../components/CompanyPatternIcon";
import { Field, ToggleField, HintIcon } from "../components/agent-config-primitives";

type AgentFallbackSnippetInput = {
  onboardingTextUrl: string;
  inviteMessage?: string | null;
  guidance?: string | null;
  connectionCandidates?: string[] | null;
};

export function CompanySettings() {
  const { companies, selectedCompany, selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  // General settings local state
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [brandColor, setBrandColor] = useState("");

  // Sync local state from selected company
  useEffect(() => {
    if (!selectedCompany) return;
    setCompanyName(selectedCompany.name);
    setDescription(selectedCompany.description ?? "");
    setBrandColor(selectedCompany.brandColor ?? "");
  }, [selectedCompany]);

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState("");
  const [frozenInviteMessage, setFrozenInviteMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyDelightId, setCopyDelightId] = useState(0);
  const [inviteSnippet, setInviteSnippet] = useState<string | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [snippetCopyDelightId, setSnippetCopyDelightId] = useState(0);

  const generalDirty =
    !!selectedCompany &&
    (companyName !== selectedCompany.name ||
      description !== (selectedCompany.description ?? "") ||
      brandColor !== (selectedCompany.brandColor ?? ""));

  const generalMutation = useMutation({
    mutationFn: (data: { name: string; description: string | null; brandColor: string | null }) =>
      companiesApi.update(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: (requireApproval: boolean) =>
      companiesApi.update(selectedCompanyId!, {
        requireBoardApprovalForNewAgents: requireApproval,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      accessApi.createCompanyInvite(selectedCompanyId!, {
        allowedJoinTypes: "agent",
        expiresInHours: 72,
        agentMessage: inviteMessage.trim() || null,
      }),
    onSuccess: async (invite) => {
      setInviteError(null);
      const base = window.location.origin.replace(/\/+$/, "");
      const onboardingTextLink = invite.onboardingTextUrl
        ?? invite.onboardingTextPath
        ?? `/api/invites/${invite.token}/onboarding.txt`;
      const absoluteUrl = onboardingTextLink.startsWith("http")
        ? onboardingTextLink
        : `${base}${onboardingTextLink}`;
      setInviteLink(absoluteUrl);
      const submittedMessage = inviteMessage.trim() || null;
      const nextInviteMessage = invite.inviteMessage ?? submittedMessage;
      setInviteMessage(submittedMessage ?? "");
      setFrozenInviteMessage(nextInviteMessage);
      setSnippetCopied(false);
      setSnippetCopyDelightId(0);
      try {
        const manifest = await accessApi.getInviteOnboarding(invite.token);
        setInviteSnippet(buildAgentFallbackSnippet({
          onboardingTextUrl: absoluteUrl,
          inviteMessage: nextInviteMessage,
          guidance: manifest.onboarding.connectivity?.guidance ?? null,
          connectionCandidates: manifest.onboarding.connectivity?.connectionCandidates ?? null,
        }));
      } catch {
        setInviteSnippet(buildAgentFallbackSnippet({
          onboardingTextUrl: absoluteUrl,
          inviteMessage: nextInviteMessage,
          guidance: null,
          connectionCandidates: null,
        }));
      }
      try {
        await navigator.clipboard.writeText(absoluteUrl);
        setCopied(true);
        setCopyDelightId((prev) => prev + 1);
        setTimeout(() => setCopied(false), 2000);
      } catch { /* clipboard may not be available */ }
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId!) });
    },
    onError: (err) => {
      setInviteError(err instanceof Error ? err.message : "Failed to create invite");
    },
  });

  useEffect(() => {
    setInviteLink(null);
    setInviteError(null);
    setInviteMessage("");
    setFrozenInviteMessage(null);
    setCopied(false);
    setCopyDelightId(0);
    setInviteSnippet(null);
    setSnippetCopied(false);
    setSnippetCopyDelightId(0);
  }, [selectedCompanyId]);
  const archiveMutation = useMutation({
    mutationFn: ({
      companyId,
      nextCompanyId,
    }: {
      companyId: string;
      nextCompanyId: string | null;
    }) => companiesApi.archive(companyId).then(() => ({ nextCompanyId })),
    onSuccess: async ({ nextCompanyId }) => {
      if (nextCompanyId) {
        setSelectedCompanyId(nextCompanyId);
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.stats });
    },
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Settings" },
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">
        No company selected. Select a company from the switcher above.
      </div>
    );
  }

  function handleSaveGeneral() {
    generalMutation.mutate({
      name: companyName.trim(),
      description: description.trim() || null,
      brandColor: brandColor || null,
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Company Settings</h1>
      </div>

      {/* General */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          General
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <Field label="Company name" hint="The display name for your company.">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </Field>
          <Field label="Description" hint="Optional description shown in the company profile.">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={description}
              placeholder="Optional company description"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Appearance */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Appearance
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <CompanyPatternIcon
                companyName={companyName || selectedCompany.name}
                brandColor={brandColor || null}
                className="rounded-[14px]"
              />
            </div>
            <div className="flex-1 space-y-2">
              <Field label="Brand color" hint="Sets the hue for the company icon. Leave empty for auto-generated color.">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandColor || "#6366f1"}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={brandColor}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^#[0-9a-fA-F]{0,6}$/.test(v)) {
                        setBrandColor(v);
                      }
                    }}
                    placeholder="Auto"
                    className="w-28 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  />
                  {brandColor && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBrandColor("")}
                      className="text-xs text-muted-foreground"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Save button for General + Appearance */}
      {generalDirty && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSaveGeneral}
            disabled={generalMutation.isPending || !companyName.trim()}
          >
            {generalMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
          {generalMutation.isSuccess && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {generalMutation.isError && (
            <span className="text-xs text-destructive">
              {generalMutation.error instanceof Error
                ? generalMutation.error.message
                : "Failed to save"}
            </span>
          )}
        </div>
      )}

      {/* Hiring */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Hiring
        </div>
        <div className="rounded-md border border-border px-4 py-3">
          <ToggleField
            label="Require board approval for new hires"
            hint="New agent hires stay pending until approved by board."
            checked={!!selectedCompany.requireBoardApprovalForNewAgents}
            onChange={(v) => settingsMutation.mutate(v)}
          />
        </div>
      </div>

      {/* Invites */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Invites
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              Generate an agent onboarding link (`.txt`) for OpenClaw-style join flows.
            </span>
            <HintIcon text="Creates an agent-only invite link that expires in 72 hours and copies the onboarding text URL." />
          </div>
          <Field
            label="Agent message (optional)"
            hint="Included in the onboarding .txt document and frozen after link generation."
          >
            <textarea
              className="min-h-[84px] w-full resize-y rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-80"
              placeholder="Optional message for the joining agent..."
              value={inviteLink ? (frozenInviteMessage ?? "") : inviteMessage}
              readOnly={Boolean(inviteLink)}
              onChange={(event) => setInviteMessage(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => inviteMutation.mutate()} disabled={inviteMutation.isPending}>
              {inviteMutation.isPending ? "Generating..." : "Generate agent link"}
            </Button>
            {inviteLink && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setInviteLink(null);
                  setFrozenInviteMessage(null);
                  setCopied(false);
                  setInviteSnippet(null);
                  setSnippetCopied(false);
                }}
              >
                New message
              </Button>
            )}
          </div>
          {inviteLink && (
            <p className="text-xs text-muted-foreground">Message is frozen for this invite link.</p>
          )}
          {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
          {inviteLink && (
            <div className="rounded-md border border-border bg-muted/30 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">Agent onboarding link</div>
                {copied && (
                  <span key={copyDelightId} className="flex items-center gap-1 text-xs text-green-600 animate-pulse">
                    <Check className="h-3 w-3" />
                    Copied
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <div className="flex-1 break-all font-mono text-xs">{inviteLink}</div>
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inviteLink);
                      setCopied(true);
                      setCopyDelightId((prev) => prev + 1);
                      setTimeout(() => setCopied(false), 2000);
                    } catch { /* clipboard may not be available */ }
                  }}
                  title="Copy link"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          )}
          {inviteSnippet && (
            <div className="rounded-md border border-border bg-muted/30 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">Fallback snippet for agent chat</div>
                {snippetCopied && (
                  <span key={snippetCopyDelightId} className="flex items-center gap-1 text-xs text-green-600 animate-pulse">
                    <Check className="h-3 w-3" />
                    Copied
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-1.5">
                <textarea
                  className="min-h-[160px] w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none"
                  value={inviteSnippet}
                  readOnly
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(inviteSnippet);
                        setSnippetCopied(true);
                        setSnippetCopyDelightId((prev) => prev + 1);
                        setTimeout(() => setSnippetCopied(false), 2000);
                      } catch { /* clipboard may not be available */ }
                    }}
                  >
                    {snippetCopied ? "Copied snippet" : "Copy snippet"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Archive */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-amber-700 uppercase tracking-wide">
          Archive
        </div>
        <div className="space-y-3 rounded-md border border-amber-300/60 bg-amber-100/30 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Archive this company to hide it from the sidebar. This persists in the database.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={archiveMutation.isPending || selectedCompany.status === "archived"}
              onClick={() => {
                if (!selectedCompanyId) return;
                const confirmed = window.confirm(
                  `Archive company "${selectedCompany.name}"? It will be hidden from the sidebar.`,
                );
                if (!confirmed) return;
                const nextCompanyId = companies.find((company) =>
                  company.id !== selectedCompanyId && company.status !== "archived")?.id ?? null;
                archiveMutation.mutate({ companyId: selectedCompanyId, nextCompanyId });
              }}
            >
              {archiveMutation.isPending
                ? "Archiving..."
                : selectedCompany.status === "archived"
                  ? "Already archived"
                  : "Archive company"}
            </Button>
            {archiveMutation.isError && (
              <span className="text-xs text-destructive">
                {archiveMutation.error instanceof Error
                  ? archiveMutation.error.message
                  : "Failed to archive company"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function buildAgentFallbackSnippet(input: AgentFallbackSnippetInput) {
  const lines = [
    "Paperclip onboarding fallback snippet",
    "Use this if the agent cannot open the onboarding URL directly.",
    "",
    `Onboarding .txt URL: ${input.onboardingTextUrl}`,
    "",
  ];

  if (input.inviteMessage) {
    lines.push("Message from inviter:", input.inviteMessage, "");
  }

  lines.push("Connectivity guidance:");
  lines.push(input.guidance || "Try reachable Paperclip hosts, then continue with the onboarding URL.");
  lines.push("");

  const candidates = (input.connectionCandidates ?? [])
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  if (candidates.length > 0) {
    lines.push("Suggested Paperclip base URLs:");
    for (const candidate of candidates) {
      lines.push(`- ${candidate}`);
    }
    lines.push("", "For each candidate, test: GET <candidate>/api/health");
  }

  lines.push(
    "",
    "If none are reachable, ask the human operator for a reachable hostname/address.",
    "In authenticated/private mode they may need:",
    "- pnpm paperclipai allowed-hostname <host>",
    "- restart Paperclip and retry onboarding.",
  );

  return `${lines.join("\n")}\n`;
}
