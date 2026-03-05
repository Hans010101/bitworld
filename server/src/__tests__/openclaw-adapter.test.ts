import { afterEach, describe, expect, it, vi } from "vitest";
import { execute, testEnvironment } from "@paperclipai/adapter-openclaw/server";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

function buildContext(
  config: Record<string, unknown>,
  overrides?: Partial<AdapterExecutionContext>,
): AdapterExecutionContext {
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
    ...overrides,
  };
}

function sseResponse(lines: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    statusText: "OK",
    headers: {
      "content-type": "text/event-stream",
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("openclaw adapter execute", () => {
  it("uses strict SSE and includes canonical PAPERCLIP context in text payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        "event: response.completed\n",
        'data: {"type":"response.completed","status":"completed"}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute(
      buildContext({
        url: "https://agent.example/sse",
        method: "POST",
        payloadTemplate: { foo: "bar", text: "OpenClaw task prompt" },
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as Record<string, unknown>;
    expect(body.foo).toBe("bar");
    expect(body.stream).toBe(true);
    expect(body.sessionKey).toBe("paperclip");
    expect((body.paperclip as Record<string, unknown>).streamTransport).toBe("sse");
    expect((body.paperclip as Record<string, unknown>).runId).toBe("run-123");
    expect((body.paperclip as Record<string, unknown>).sessionKey).toBe("paperclip");
    expect(
      ((body.paperclip as Record<string, unknown>).env as Record<string, unknown>).PAPERCLIP_RUN_ID,
    ).toBe("run-123");
    const text = String(body.text ?? "");
    expect(text).toContain("OpenClaw task prompt");
    expect(text).toContain("PAPERCLIP_RUN_ID=run-123");
    expect(text).toContain("PAPERCLIP_AGENT_ID=agent-123");
    expect(text).toContain("PAPERCLIP_COMPANY_ID=company-123");
    expect(text).toContain("PAPERCLIP_TASK_ID=task-123");
    expect(text).toContain("PAPERCLIP_WAKE_REASON=issue_assigned");
    expect(text).toContain("PAPERCLIP_LINKED_ISSUE_IDS=issue-123");
  });

  it("derives issue session keys when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        "event: done\n",
        "data: [DONE]\n\n",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute(
      buildContext({
        url: "https://agent.example/sse",
        method: "POST",
        sessionKeyStrategy: "issue",
      }),
    );

    expect(result.exitCode).toBe(0);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as Record<string, unknown>;
    expect(body.sessionKey).toBe("paperclip:issue:issue-123");
    expect((body.paperclip as Record<string, unknown>).sessionKey).toBe("paperclip:issue:issue-123");
  });

  it("maps requests to OpenResponses schema for /v1/responses endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        "event: response.completed\n",
        'data: {"type":"response.completed","status":"completed"}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute(
      buildContext({
        url: "https://agent.example/v1/responses",
        method: "POST",
        payloadTemplate: {
          model: "openclaw",
          user: "paperclip",
        },
      }),
    );

    expect(result.exitCode).toBe(0);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.model).toBe("openclaw");
    expect(typeof body.input).toBe("string");
    expect(String(body.input)).toContain("PAPERCLIP_RUN_ID=run-123");
    expect(body.metadata).toBeTypeOf("object");
    expect((body.metadata as Record<string, unknown>).PAPERCLIP_RUN_ID).toBe("run-123");
    expect(body.text).toBeUndefined();
    expect(body.paperclip).toBeUndefined();
    expect(body.sessionKey).toBeUndefined();

    const headers = (fetchMock.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers["x-openclaw-session-key"]).toBe("paperclip");
  });

  it("fails when SSE endpoint does not return text/event-stream", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "unexpected payload" }), {
        status: 200,
        statusText: "OK",
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute(
      buildContext({
        url: "https://agent.example/sse",
        method: "POST",
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("openclaw_sse_expected_event_stream");
  });

  it("fails when SSE stream closes without a terminal event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        "event: response.delta\n",
        'data: {"type":"response.delta","delta":"partial"}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute(
      buildContext({
        url: "https://agent.example/sse",
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("openclaw_sse_stream_incomplete");
  });

  it("fails with explicit text-required error when endpoint rejects payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "text required" }), {
        status: 400,
        statusText: "Bad Request",
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute(
      buildContext({
        url: "https://agent.example/sse",
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("openclaw_text_required");
  });

  it("rejects non-sse transport configuration", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute(
      buildContext({
        url: "https://agent.example/sse",
        streamTransport: "webhook",
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("openclaw_stream_transport_unsupported");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects /hooks/wake compatibility endpoints in strict SSE mode", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await execute(
      buildContext({
        url: "https://agent.example/hooks/wake",
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("openclaw_sse_incompatible_endpoint");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("openclaw adapter environment checks", () => {
  it("reports /hooks/wake endpoints as incompatible for strict SSE mode", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 405, statusText: "Method Not Allowed" }));
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

    const check = result.checks.find((entry) => entry.code === "openclaw_wake_endpoint_incompatible");
    expect(check?.level).toBe("error");
  });

  it("reports unsupported streamTransport settings", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 405, statusText: "Method Not Allowed" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await testEnvironment({
      companyId: "company-123",
      adapterType: "openclaw",
      config: {
        url: "https://agent.example/sse",
        streamTransport: "webhook",
      },
    });

    const check = result.checks.find((entry) => entry.code === "openclaw_stream_transport_unsupported");
    expect(check?.level).toBe("error");
  });
});
