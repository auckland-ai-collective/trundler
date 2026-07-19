# Project instructions — trundler

## The trundler-mcp package is a separate repo — never edit it, file an issue

This app consumes `@auckland-ai-collective/trundler-mcp` as a dependency (it lives
in `node_modules`). It is a **separate GitHub repository** and is NOT part of this
codebase.

- **Never modify the MCP directly.** Do not edit anything under
  `node_modules` — those changes are throwaway
  (overwritten on reinstall) and are not the source of truth.
- **Investigating it is fine** — read its built output to understand behavior and
  diagnose problems.
- **When the MCP needs a change** (a bug, a missing option, a behavior request),
  the recommendation goes to its GitHub repo as an **issue** — not into this repo,
  not into `node_modules`.

Repo: `auckland-ai-collective/trundler-mcp`
Issues: https://github.com/auckland-ai-collective/trundler-mcp/issues

File it with the `gh` CLI:

```bash
gh issue create --repo auckland-ai-collective/trundler-mcp \
  --title "<concise summary>" \
  --body "<problem, evidence with file:line from the built package, and a recommended change>"
```

Confirm the title/body with the PM before posting (it's public and outward-facing).
