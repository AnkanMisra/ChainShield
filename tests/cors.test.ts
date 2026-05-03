import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { buildApp } from "../src/risk-gate/app.js";

const ENV_KEY = "WEB_ORIGIN";
const PRESERVED = process.env[ENV_KEY];

beforeEach(() => {
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (PRESERVED === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = PRESERVED;
  }
});

async function preflight(app: ReturnType<typeof buildApp>, origin: string) {
  const res = await app.inject({
    method: "OPTIONS",
    url: "/policies",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  return {
    statusCode: res.statusCode,
    allowOrigin: res.headers["access-control-allow-origin"] ?? null,
  };
}

describe("CORS WEB_ORIGIN parser", () => {
  it("falls back to the dev origins when WEB_ORIGIN is unset", async () => {
    const app = buildApp();
    const r = await preflight(app, "http://127.0.0.1:4321");
    expect(r.statusCode).toBe(204);
    expect(r.allowOrigin).toBe("http://127.0.0.1:4321");
    await app.close();
  });

  it("treats comma-separated entries as a literal allow-list", async () => {
    process.env[ENV_KEY] = "https://chainshield.pages.dev,http://localhost:4321";
    const app = buildApp();

    const allowed = await preflight(app, "https://chainshield.pages.dev");
    expect(allowed.allowOrigin).toBe("https://chainshield.pages.dev");

    const denied = await preflight(app, "https://malicious.example.com");
    expect(denied.allowOrigin).not.toBe("https://malicious.example.com");

    await app.close();
  });

  it("compiles entries wrapped in slashes as RegExp so cloudflare preview deploys match", async () => {
    process.env[ENV_KEY] = "https://chainshield.pages.dev,/^https:\\/\\/[a-z0-9-]+\\.chainshield\\.pages\\.dev$/";
    const app = buildApp();

    const prod = await preflight(app, "https://chainshield.pages.dev");
    expect(prod.allowOrigin).toBe("https://chainshield.pages.dev");

    const preview = await preflight(app, "https://abc123.chainshield.pages.dev");
    expect(preview.allowOrigin).toBe("https://abc123.chainshield.pages.dev");

    const sneaky = await preflight(app, "https://chainshield.pages.dev.evil.com");
    expect(sneaky.allowOrigin).not.toBe("https://chainshield.pages.dev.evil.com");

    await app.close();
  });
});
