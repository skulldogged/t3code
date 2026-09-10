import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  os: "android",
  native: null as {
    configure?: ReturnType<typeof vi.fn>;
    clear?: ReturnType<typeof vi.fn>;
    publishLocalActivity?: ReturnType<typeof vi.fn>;
    publishLocalAlert?: ReturnType<typeof vi.fn>;
  } | null,
  config: { scheme: ["t3code-preview"], extra: { iosPersonalTeamBuild: false } },
  requireModule: vi.fn(),
}));

vi.mock("expo", () => ({ requireOptionalNativeModule: mocks.requireModule }));
vi.mock("expo-constants", () => ({ default: { expoConfig: mocks.config } }));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mocks.os;
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  mocks.os = "android";
  mocks.native = {
    configure: vi.fn(),
    clear: vi.fn(),
    publishLocalActivity: vi.fn(),
    publishLocalAlert: vi.fn(),
  };
  mocks.config.extra.iosPersonalTeamBuild = false;
  mocks.requireModule.mockReset().mockImplementation(() => mocks.native);
});

describe("Android native notification capability", () => {
  it("uses the installed module and the build variant's deep-link scheme", async () => {
    const {
      configureAndroidAgentNotifications,
      clearAndroidAgentNotifications,
      publishLocalAndroidAgentActivity,
      publishLocalAndroidAgentAlert,
    } = await import("./androidNotifications");
    const { supportsAgentAwarenessPush } = await import("./capabilities");
    // An iOS-only signing restriction must not disable Android notifications.
    mocks.config.extra.iosPersonalTeamBuild = true;
    expect(supportsAgentAwarenessPush()).toBe(true);
    configureAndroidAgentNotifications("device", "user", false);
    expect(mocks.native?.configure).toHaveBeenCalledWith("device", "user", "t3code-preview", false);
    clearAndroidAgentNotifications();
    expect(mocks.native?.clear).toHaveBeenCalledOnce();
    publishLocalAndroidAgentActivity("Working", "Project · Working", "/threads/env/thread", true);
    publishLocalAndroidAgentAlert("Input required", "Project · Model", "/threads/env/thread", "id");
    expect(mocks.native?.publishLocalActivity).toHaveBeenCalledWith(
      "Working",
      "Project · Working",
      "/threads/env/thread",
      true,
    );
    expect(mocks.native?.publishLocalAlert).toHaveBeenCalledWith(
      "Input required",
      "Project · Model",
      "/threads/env/thread",
      "id",
    );
  });

  it.each([null, { clear: vi.fn() }, { configure: vi.fn() }])(
    "disables push when the native binary is missing required methods (%j)",
    async (native) => {
      mocks.native = native;
      const { configureAndroidAgentNotifications, clearAndroidAgentNotifications } =
        await import("./androidNotifications");
      const { supportsAgentAwarenessPush } = await import("./capabilities");
      expect(supportsAgentAwarenessPush()).toBe(false);
      expect(() => configureAndroidAgentNotifications("device", "user", true)).not.toThrow();
      expect(() => clearAndroidAgentNotifications()).not.toThrow();
    },
  );

  it("preserves the iOS personal-team restriction without loading Android code", async () => {
    mocks.os = "ios";
    const { supportsAgentAwarenessPush } = await import("./capabilities");
    expect(supportsAgentAwarenessPush()).toBe(true);
    mocks.config.extra.iosPersonalTeamBuild = true;
    expect(supportsAgentAwarenessPush()).toBe(false);
    expect(mocks.requireModule).not.toHaveBeenCalled();
  });
});
