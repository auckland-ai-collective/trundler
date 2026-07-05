# Trundler — local grocery-shopping companion

A desktop app that lets you **have a dialogue with an agent** while it shops for you.
The agent's brain runs either **locally (Ollama)** or in the **cloud (Claude)**; either
way, all the actual grocery I/O happens on your own machine and residential connection
via [`trundler-mcp`](https://www.npmjs.com/package/@auckland-ai-collective/trundler-mcp)
([source](https://github.com/auckland-ai-collective/trundler-mcp)), so there's no
bot-detection or hosting problem to solve. It's a normal npm dependency of this app —
you don't install it separately.

> **Cloud brain, local hands.** Bot detection only cares about the requests hitting the
> grocery sites — those are made by trundler-mcp on your machine. The model that decides
> _what_ to fetch can run wherever you like.

## Architecture

```
Electron main (Node)                         Renderer (React)
├── TrundlerMcp ──stdio──► trundler-mcp ──► grocery sites (residential IP)
├── Agent loop (shared)                      ├── chat + streamed tokens
│    ├── OllamaBackend   (local)             ├── product grid (from tool results)
│    └── AnthropicBackend (cloud)            ├── live cart panel
└── IPC + approval gate ◄──── approve/deny ──┤ approval modal (cart mutations)
```

- **One shared agent loop** ([`src/main/agent/loop.ts`](src/main/agent/loop.ts)) drives
  the conversation. It's parameterised by a `Backend`, so switching Ollama ↔ Claude is a
  dropdown, not a rewrite.
- **Tools come from MCP**, so both brains inherit trundler's own product-listing
  instructions (letter labels, price-per-unit, cheapest-first).
- **Cart mutations require approval** — `cart_add` / `cart_update` / `cart_remove` pop an
  approval modal before they run.
- **Structured tool results become UI**: product results render as a card grid; cart
  tools refresh the live cart panel.
- **Auth is first-class**: a status chip shows whether you're signed in to Countdown,
  with **Log in** / **Log out** buttons in the top bar (no need to discover it via an error).

## Prerequisites

- **Node ≥ 20** (dev has 22).
- **[Ollama](https://ollama.com)** running locally with a tool-capable model:
  ```
  ollama pull llama3.1:8b      # fast, good enough for dev
  ollama pull qwen3:14b        # stronger tool use, slower
  ```

That's it — the grocery data layer (`@auckland-ai-collective/trundler-mcp`) is a
dependency and installs automatically. No second repo to clone or build.

## Setup

```bash
npm install     # also pulls trundler-mcp (no browser download; that's lazy — see below)
```

### Verify the plumbing (no GUI)

```bash
npm run smoke -- "find jasmine rice on special"   # stdio round-trip via the MCP + Ollama
npm run libcheck                                   # in-process (buildServer) round-trip
```

Both resolve the MCP from the installed package, run a real tool call, and print the
result — use them to confirm your model works before launching the app.

### Run the app

```bash
npm run dev        # launches the Electron app with HMR
```

Build a distributable:

```bash
npm run build      # compile main/preload/renderer into out/
npm run dist       # + package a Windows installer (electron-builder)
```

## Signing in (Countdown)

Countdown/Woolworths needs a login for cart and order history. Two ways:

- **In the app:** click **Log in** in the top bar — a real browser window opens; sign in
  there and the app captures the session. The **first** sign-in downloads a browser
  (~150 MB, one-time) — the app shows a banner while that happens.
- **From the CLI:** `npx trundler login` (the package ships a `trundler` bin).

**Log out** (in the app) clears the stored session and forces re-authentication. New
World and Pak'nSave need no login (anonymous, read-only).

## Configuration

Everything is settable in-app (⚙︎ in the top bar): brain (Ollama/Claude), model, Ollama
host, Claude API key, MCP server path, and default provider. Defaults can also come from
env vars — see [`.env.example`](.env.example). Settings persist to `config.json` in the
app's userData directory.

**MCP path:** by default the app resolves the server from the installed
`@auckland-ai-collective/trundler-mcp` package automatically — no path to set. Override
with `TRUNDLER_MCP_PATH` (or the ⚙︎ field) only if you're pointing at a local checkout.

### Providers

| Provider     | id          | Cart | Notes                                             |
| ------------ | ----------- | :--: | ------------------------------------------------- |
| Countdown    | `countdown` |  ✅  | Needs login — use the **Log in** button.          |
| New World    | `newworld`  |  ❌  | Read-only; pick a store first (agent does this).  |
| Pak'nSave    | `paknsave`  |  ❌  | Read-only; per-store pricing.                     |

## Debug logging / telemetry

Trundler writes a structured **JSONL session log** capturing the whole interaction:
the user's prompt, **the model/backend in use**, every MCP tool call and its result,
cart state, approvals, and errors. One file per app run in the app's
`userData/logs/` directory (use the **open logs** button in the debug footer, or
`shell` reveal).

- **On automatically in dev** (`npm run dev`).
- **In production**, enable with `--debug` or `TRUNDLER_DEBUG=1` so a user can capture
  and send you their logs:
  ```
  Trundler.exe --debug
  ```

Each line is one JSON event, e.g.:

```json
{"t":"2026-07-05T…","type":"user-message","text":"add A to cart","backend":"ollama","model":"llama3.1:8b","provider":"countdown"}
{"t":"2026-07-05T…","type":"mcp-call","name":"cart_add","args":{"sku":"601342","quantity":1}}
{"t":"2026-07-05T…","type":"mcp-result","name":"cart_add","ok":true,"provider":"countdown","data":{…}}
{"t":"2026-07-05T…","type":"cart-state","provider":"countdown","itemCount":1,"detailedItems":0,"total":null}
```

The debug log is what let us pin down real bugs — e.g. `detailedItems: 0` with a
non-zero `itemCount` was the fingerprint of a cart-detail mapping bug in trundler-mcp
([#1](https://github.com/auckland-ai-collective/trundler-mcp/issues/1), now fixed).
The cart panel still tolerates sparse data defensively in case a provider returns it.

## Project layout

```
src/
  shared/types.ts          shared types (domain types re-exported from the MCP package)
  main/
    index.ts               window, IPC, orchestration, approval + auth gate
    config.ts              config + MCP path resolution (from the installed package)
    mcpClient.ts           trundler-mcp stdio client (spawn + reconnect)
    logger.ts              JSONL session logger
    agent/
      loop.ts              shared tool loop
      ollamaBackend.ts     local model (streaming + tools)
      anthropicBackend.ts  Claude (streaming SSE + tools)
      system.ts            system prompt (+ MCP instructions)
  preload/index.ts         contextBridge API
  renderer/                React chat UI
scripts/smoke.mjs          headless stdio MCP + Ollama check
scripts/lib-check.mjs      headless in-process (buildServer) check
```

## Notes / next steps

- Only the Ollama path is exercised by the smoke test; the Claude path shares the same
  loop and is wired but needs an API key to try.
- The app spawns the MCP as a subprocess with Electron's bundled Node
  (`ELECTRON_RUN_AS_NODE`). The package also exposes a library entry (`buildServer`), so a
  packaged build can instead mount the MCP **in-process** (in-memory transport) to avoid
  subprocess/path issues — validated by `npm run libcheck`.

## License

MIT © 2026 Michael Wells &lt;mike@aaic.nz&gt; — see [LICENSE](LICENSE).

An open-source project. Contributions welcome.
