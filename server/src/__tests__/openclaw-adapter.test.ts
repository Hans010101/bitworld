import { afterEach, describe, expect, it, vi } from "vitest";
import { execute, testEnvironment } from "@paperclipai/adapter-openclaw/server";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

function buildContext(config: Record<string, unknown>): AdapterExecutionContext {
  return {
    runId: "run-123",
    agent: {
      id: "agent-123",
      companyId: "company-123",
      name: "OpenClaw Agent",
      adapterType: "openclaw",
      adapterConfig: {},
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: null,
    },
    config,
    context: {
      taskId: "task-123",
      issueId: "issue-123",
      wakeReason: "issue_assigned",
      issueIds: ["issue-123"],
    },
    onLog: async () => {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("openclaw adapter execute", () => {
  it("sends structured paperclip payload to mapped endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, statusText: "OK" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute(
      buildContext({
        url: "https://agent.example/hooks/paperclip",
        method: "POST",
        payloadTemplate: { foo: "bar" },
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as Record<string, unknown>;
    expect(body.foo).toBe("bar");
    expect(body.paperclip).toBeTypeOf("object");
    expect((body.paperclip as Record<string, unknown>).runId).toBe("run-123");
  });

  it("uses wake text payload for /hooks/wake endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, statusText: "OK" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute(
      buildContext({
        url: "https://agent.example/hooks/wake",
        method: "POST",
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as Record<string, unknown>;
    expect(body.mode).toBe("now");
    expect(typeof body.text).toBe("string");
    expect(body.paperclip).toBeUndefined();
  });

  it("retries with wake text payload when endpoint reports text required", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: "text required" }), {
          status: 400,
          statusText: "Bad Request",
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200, statusText: "OK" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute(
      buildContext({
        url: "https://agent.example/hooks/paperclip",
        method: "POST",
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as Record<string, unknown>;
    expect(firstBody.paperclip).toBeTypeOf("object");

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body ?? "{}")) as Record<string, unknown>;
    expect(secondBody.mode).toBe("now");
    expect(typeof secondBody.text).toBe("string");
    expect(result.resultJson?.compatibilityMode).toBe("wake_text");
  });
});

describe("openclaw adapter environment checks", () => {
  it("reports compatibility mode info for /hooks/wake endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 405, statusText: "Method Not Allowed" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await testEnvironment({
      companyId: "company-123",
      adapterType: "openclaw",
      config: {
        url: "https://agent.example/hooks/wake",
      },
      deployment: {
        mode: "authenticated",
        exposure: "private",
        bindHost: "paperclip.internal",
        allowedHostnames: ["paperclip.internal"],
      },
    });

    const compatibilityCheck = result.checks.find((check) => check.code === "openclaw_wake_endpoint_compat_mode");
    expect(compatibilityCheck?.level).toBe("info");
  });
});
