import { describe, expect, it } from "vitest";
import { buildJoinDefaultsPayloadForAccept } from "../routes/access.js";

describe("buildJoinDefaultsPayloadForAccept", () => {
  it("maps OpenClaw compatibility fields into agent defaults", () => {
    const result = buildJoinDefaultsPayloadForAccept({
      adapterType: "openclaw",
      defaultsPayload: null,
      responsesWebhookUrl: "http://localhost:18789/v1/responses",
      paperclipApiUrl: "http://host.docker.internal:3100",
      inboundOpenClawAuthHeader: "gateway-token",
    }) as Record<string, unknown>;

    expect(result).toMatchObject({
      url: "http://localhost:18789/v1/responses",
      paperclipApiUrl: "http://host.docker.internal:3100",
      headers: {
        "x-openclaw-auth": "gateway-token",
      },
    });
  });

  it("does not overwrite explicit OpenClaw defaults when already provided", () => {
    const result = buildJoinDefaultsPayloadForAccept({
      adapterType: "openclaw",
      defaultsPayload: {
        url: "https://example.com/v1/responses",
        method: "POST",
        headers: {
          "x-openclaw-auth": "existing-token",
        },
        paperclipApiUrl: "https://paperclip.example.com",
      },
      responsesWebhookUrl: "https://legacy.example.com/v1/responses",
      responsesWebhookMethod: "PUT",
      paperclipApiUrl: "https://legacy-paperclip.example.com",
      inboundOpenClawAuthHeader: "legacy-token",
    }) as Record<string, unknown>;

    expect(result).toMatchObject({
      url: "https://example.com/v1/responses",
      method: "POST",
      paperclipApiUrl: "https://paperclip.example.com",
      headers: {
        "x-openclaw-auth": "existing-token",
      },
    });
  });

  it("leaves non-openclaw payloads unchanged", () => {
    const defaultsPayload = { command: "echo hello" };
    const result = buildJoinDefaultsPayloadForAccept({
      adapterType: "process",
      defaultsPayload,
      responsesWebhookUrl: "https://ignored.example.com",
      inboundOpenClawAuthHeader: "ignored-token",
    });

    expect(result).toEqual(defaultsPayload);
  });
});
