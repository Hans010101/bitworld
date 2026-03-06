import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { assetRoutes } from "../routes/assets.js";
import type { StorageService } from "../storage/types.js";

const { createAssetMock, getAssetByIdMock, logActivityMock } = vi.hoisted(() => ({
  createAssetMock: vi.fn(),
  getAssetByIdMock: vi.fn(),
  logActivityMock: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  assetService: vi.fn(() => ({
    create: createAssetMock,
    getById: getAssetByIdMock,
  })),
  logActivity: logActivityMock,
}));

function createAsset() {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "asset-1",
    companyId: "company-1",
    provider: "local",
    objectKey: "assets/abc",
    contentType: "image/svg+xml",
    byteSize: 40,
    sha256: "sha256-sample",
    originalFilename: "logo.svg",
    createdByAgentId: null,
    createdByUserId: "user-1",
    createdAt: now,
    updatedAt: now,
  };
}

function createStorageService(contentType = "image/svg+xml"): StorageService {
  const putFile: StorageService["putFile"] = vi.fn(async (input: {
    companyId: string;
    namespace: string;
    originalFilename: string | null;
    contentType: string;
    body: Buffer;
  }) => {
    return {
      provider: "local_disk" as const,
      objectKey: `${input.namespace}/${input.originalFilename ?? "upload"}`,
      contentType: contentType || input.contentType,
      byteSize: input.body.length,
      sha256: "sha256-sample",
      originalFilename: input.originalFilename,
    };
  });

  return {
    provider: "local_disk" as const,
    putFile,
    getObject: vi.fn(),
    headObject: vi.fn(),
    deleteObject: vi.fn(),
  };
}

function createApp(storage: ReturnType<typeof createStorageService>) {
  const app = express();
  app.use((req, _res, next) => {
    req.actor = {
      type: "board",
      source: "local_implicit",
      userId: "user-1",
    };
    next();
  });
  app.use("/api", assetRoutes({} as any, storage));
  return app;
}

describe("POST /api/companies/:companyId/assets/images", () => {
  afterEach(() => {
    createAssetMock.mockReset();
    getAssetByIdMock.mockReset();
    logActivityMock.mockReset();
  });

  it("accepts SVG image uploads and returns an asset path", async () => {
    const svg = createStorageService("image/svg+xml");
    const app = createApp(svg);

    createAssetMock.mockResolvedValue(createAsset());

    const res = await request(app)
      .post("/api/companies/company-1/assets/images")
      .field("namespace", "companies")
      .attach("file", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "logo.svg");

    expect(res.status).toBe(201);
    expect(res.body.contentPath).toBe("/api/assets/asset-1/content");
    expect(createAssetMock).toHaveBeenCalledTimes(1);
    expect(svg.putFile).toHaveBeenCalledWith({
      companyId: "company-1",
      namespace: "assets/companies",
      originalFilename: "logo.svg",
      contentType: "image/svg+xml",
      body: expect.any(Buffer),
    });
  });

  it("rejects files larger than 100 KB", async () => {
    const app = createApp(createStorageService());
    createAssetMock.mockResolvedValue(createAsset());

    const file = Buffer.alloc(100 * 1024 + 1, "a");
    const res = await request(app)
      .post("/api/companies/company-1/assets/images")
      .field("namespace", "companies")
      .attach("file", file, "too-large.png");

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Image exceeds 102400 bytes");
  });

  it("allows larger non-logo images within the general asset limit", async () => {
    const png = createStorageService("image/png");
    const app = createApp(png);

    createAssetMock.mockResolvedValue({
      ...createAsset(),
      contentType: "image/png",
      originalFilename: "goal.png",
    });

    const file = Buffer.alloc(150 * 1024, "a");
    const res = await request(app)
      .post("/api/companies/company-1/assets/images")
      .field("namespace", "goals")
      .attach("file", file, "goal.png");

    expect(res.status).toBe(201);
    expect(createAssetMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported image types", async () => {
    const app = createApp(createStorageService("text/plain"));
    createAssetMock.mockResolvedValue(createAsset());

    const res = await request(app)
      .post("/api/companies/company-1/assets/images")
      .field("namespace", "companies")
      .attach("file", Buffer.from("not an image"), "note.txt");

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Unsupported image type: text/plain");
    expect(createAssetMock).not.toHaveBeenCalled();
  });
});
