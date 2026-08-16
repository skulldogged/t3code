export type ProviderIconKind =
  | "claudeAgent"
  | "codex"
  | "cursor"
  | "grok"
  | "opencode"
  | "pi"
  | "unknown";

const KNOWN_PROVIDER_ICON_KINDS = new Set<ProviderIconKind>([
  "claudeAgent",
  "codex",
  "cursor",
  "grok",
  "opencode",
  "pi",
]);

function knownProviderIconKind(value: string | null | undefined): ProviderIconKind | null {
  const normalized = value?.trim();
  return normalized && KNOWN_PROVIDER_ICON_KINDS.has(normalized as ProviderIconKind)
    ? (normalized as ProviderIconKind)
    : null;
}

export function resolveProviderIconKind(input: {
  readonly driver: string | null | undefined;
  readonly instanceId?: string | null | undefined;
}): ProviderIconKind {
  const instanceKind = knownProviderIconKind(input.instanceId);
  if (instanceKind === "pi") {
    return "pi";
  }
  return knownProviderIconKind(input.driver) ?? instanceKind ?? "unknown";
}
