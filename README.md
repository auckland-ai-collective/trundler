# Trundler — local grocery-shopping companion

A desktop app that lets you **have a dialogue with an agent** while it shops for you.
The agent's brain runs either **locally (Ollama)** or in the **cloud (Claude)**; either
way, all the actual grocery I/O happens on your own machine and residential connection
via [`trundler-mcp`](../../MCP/trundler-mcp), so there's no bot-detection or hosting
problem to solve.

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

## Prerequisites

- **Node ≥ 20** (dev has 22).
- **[Ollama](https://ollama.com)** running locally with a tool-capable model:
  ```
  ollama pull llama3.1:8b      # fast, good enough for dev
  ollama pull qwen3:14b        # stronger tool use, slower
  ```
- **trundler-mcp built**: in `D:/Projects/MCP/trundler-mcp`, run `npm run build`.
  For Countdown cart/orders, log in once there: `npm run cli login`.

## Setup

```bash
npm install
```

### Verify the plumbing (no GUI)

```bash
npm run smoke -- "find jasmine rice on special"
```

This connects to trundler-mcp, runs one Ollama tool-calling loop, executes the tool
call, and prints the transcript. Use it to confirm your model + MCP path work before
launching the app.

### Run the app

```bash
npm run dev        # launches the Electron app with HMR
```

Build a distributable:

```bash
npm run build      # compile main/preload/renderer into out/
npm run dist       # + package a Windows installer (electron-builder)
```

## Configuration

Everything is settable in-app (⚙︎ in the top bar): brain (Ollama/Claude), model, Ollama
host, Claude API key, MCP server path, and default provider. Defaults can also come from
env vars — see [`.env.example`](.env.example). Settings persist to
`config.json` in the app's userData directory.

### Providers

| Provider     | id          | Cart | Notes                                             |
| ------------ | ----------- | :--: | ------------------------------------------------- |
| Countdown    | `countdown` |  ✅  | Requires login (run `trundler login` in the MCP). |
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

`detailedItems: 0` with a non-zero `itemCount` is the fingerprint of the trundler-mcp
cart-detail mapping gap (see below).

### Known issue: cart item detail

The cart registers items correctly (the real account updates), but `cart_get` in
**trundler-mcp** currently returns items without name/price detail — its `cartGet()`
maps `/api/v1/trolleys/my` fields that don't match the actual response shape. Trundler
(this app) now shows the item count and totals and flags the missing detail; the full
fix belongs in the trundler-mcp repo:
[auckland-ai-collective/trundler-mcp#1](https://github.com/auckland-ai-collective/trundler-mcp/issues/1).

## Project layout

```
src/
  shared/types.ts          types shared across processes
  main/
    index.ts               window, IPC, orchestration, approval gate
    config.ts              load/save config
    mcpClient.ts           trundler-mcp stdio client
    agent/
      loop.ts              shared tool loop
      ollamaBackend.ts     local model (streaming + tools)
      anthropicBackend.ts  Claude (streaming SSE + tools)
      system.ts            system prompt (+ MCP instructions)
  preload/index.ts         contextBridge API
  renderer/                React chat UI
scripts/smoke.mjs          headless MCP + Ollama check
```

## Notes / next steps

- Only the Ollama path is exercised by the smoke test; the Claude path shares the same
  loop and is wired but needs an API key to try.
- Packaging currently assumes the MCP is spawned with Electron's bundled Node
  (`ELECTRON_RUN_AS_NODE`). For a shipped installer you'd bundle or reference trundler-mcp
  explicitly.

## License

MIT © 2026 Michael Wells &lt;mike@aaic.nz&gt; — see [LICENSE](LICENSE).

An open-source project. Contributions welcome.
