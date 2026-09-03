import { describe, expect, it } from "vite-plus/test";

import { resolveProviderIconKind } from "./providerIconKind";

describe("resolveProviderIconKind", () => {
  it("uses the Pi icon for the Pi driver", () => {
    expect(resolveProviderIconKind({ driver: "pi" })).toBe("pi");
  });

  it("keeps the default Pi instance on the Pi icon when driver data is stale", () => {
    expect(resolveProviderIconKind({ driver: "codex", instanceId: "pi" })).toBe("pi");
  });

  it("uses a known driver for custom provider instances", () => {
    expect(resolveProviderIconKind({ driver: "codex", instanceId: "work" })).toBe("codex");
  });

  it("preserves upstream provider kinds added after the Pi icon resolver", () => {
    expect(resolveProviderIconKind({ driver: "antigravity" })).toBe("antigravity");
  });

  it("does not label an unknown provider as OpenAI", () => {
    expect(resolveProviderIconKind({ driver: "third-party", instanceId: "work" })).toBe("unknown");
  });
});
