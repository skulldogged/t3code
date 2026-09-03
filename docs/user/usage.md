# Review usage

The Usage page combines Codex, Claude Code, and Grok Build activity from your connected
environments. It reads the providers' local session history and shows API-equivalent token cost,
processed tokens, cache savings, provider shares, and model breakdowns. Subscription billing is
separate from the raw token cost shown here.

Grok Build totals come from persisted session updates. Interactive turns that never wrote a
completed-turn record will not appear.

When a signed-in provider exposes subscription quotas, its summary row keeps the usual cost and
token summary and adds the current five-hour and weekly usage meters. Each meter shows the time
remaining until it resets. On web and desktop, hover a meter to see the exact reset time. Providers
that do not expose quota data omit the meters.

Codex Pro 5x and Pro 20x plans show `∞` for the uncapped five-hour window. Plus plans show the
five-hour percentage reported by Codex.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart. Refreshing rescans every connected environment and refetches model pricing on
each of them, so a newly released model that showed $0.00 gets a price without waiting for the daily
pricing update.
