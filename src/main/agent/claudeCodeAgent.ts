import { spawn, execFile } from 'node:child_process'
import type { ClaudeCodeStatus } from '../../shared/types.js'
import type { ClaudeCodeWorkspace } from './claudeCodeBridge.js'
import { newSessionId } from './claudeCodeBridge.js'

/**
 * Claude Code CLI as the brain, billed to the user's Claude subscription.
 *
 * Unlike the Ollama and Anthropic backends, this is not a `Backend` that
 * returns one turn at a time: the CLI runs its OWN agent loop and calls its own
 * tools, so the app's `runAgent` is bypassed entirely. What the app keeps hold
 * of is the tools themselves — they are proxied back through the bridge (see
 * claudeCodeBridge.ts), which is where tool-call, approval and tool-result
 * events are emitted from. This module therefore only deals with the model's
 * prose, errors, and the session id.
 *
 * One CLI process per user message. Conversation state lives in the CLI's own
 * session store and is picked up with `--resume`, so a message costs one spawn
 * (~2s) and only the new material is sent to the model, not the whole history.
 */

/** Conversation continuity across messages. Owned by the caller so it can be
 *  cleared on New chat / brain switch, when the CLI session no longer applies. */
export interface ClaudeCodeSession {
  id: string | null
}

export interface ClaudeCodeRunOptions {
  command: string
  model: string
  /** The user's message. Passed on stdin, so its length and quoting are safe. */
  prompt: string
  workspace: ClaudeCodeWorkspace
  session: ClaudeCodeSession
  onText: (delta: string) => void
  /** Diagnostics for the session log — never shown to the user. */
  onDebug?: (message: string, detail?: Record<string, unknown>) => void
  signal?: AbortSignal
}

/**
 * How to spell an argument that means "the empty string".
 *
 * `--tools` and `--setting-sources` are switched off by passing them nothing,
 * and on Windows the CLI is a `.cmd` shim so it has to be spawned through a
 * shell (see `runOnce`). cmd.exe drops a zero-length argument entirely, which
 * silently shifts every later flag along by one — the observed symptom was
 * `--setting-sources` being handed `--disable-slash-commands` as its value and
 * the CLI refusing to start. Passing two literal quote characters makes cmd
 * produce a real empty argument; without a shell, the empty string is correct
 * as-is and `'""'` would arrive as two stray characters.
 */
const EMPTY_ARG = process.platform === 'win32' ? '""' : ''

/**
 * Flags that contain the run. Every one of these is load-bearing:
 *
 * `--strict-mcp-config` is the critical one. Without it the CLI loads the
 * user's own MCP servers — on a developer's machine that can be dozens of
 * unrelated connectors, which cost real money to put in the prompt (a measured
 * 211k tokens of cache for a one-word reply) and would also hand a
 * grocery-shopping agent their mail and calendar.
 *
 * `--tools ""` drops every built-in tool, so the agent cannot read files or run
 * commands. MCP tools are unaffected, which leaves exactly the grocery tools
 * and nothing else.
 *
 * `--permission-mode dontAsk` + `--allowedTools mcp__trundler`: print mode has
 * no way to show a prompt, so a tool that would ask instead hangs forever.
 * Pre-approving the proxy's tools avoids that. It is not a loosening — these
 * are the only tools that exist, and cart mutations still pass through the
 * app's own approval gate on the far side of the bridge.
 */
function containmentArgs(workspace: ClaudeCodeWorkspace): string[] {
  return [
    '--strict-mcp-config',
    '--mcp-config',
    workspace.mcpConfigPath,
    '--tools',
    EMPTY_ARG,
    // Nothing of the user's Claude Code setup should reach a grocery session.
    '--setting-sources',
    EMPTY_ARG,
    '--disable-slash-commands',
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    'mcp__trundler'
  ]
}

/**
 * Environment for the CLI child.
 *
 * The point of this backend is that messages bill to the user's Claude
 * subscription rather than to API tokens, so anything in the environment that
 * could redirect inference elsewhere is dropped.
 *
 * Measured on CLI 2.1.238, `ANTHROPIC_API_KEY` is NOT in fact consulted — it
 * reports `apiKeySource: "none"` and uses its stored OAuth credentials whether
 * the variable is set or not — so clearing it is belt-and-braces against a
 * future change in that precedence, not a live fix. The app does read that
 * variable for its own Anthropic backend, so it is routinely present here.
 *
 * `CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` are the ones that genuinely reroute to
 * a different provider and account, and so matter more than the key does.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  delete env.ANTHROPIC_BASE_URL
  delete env.CLAUDE_CODE_USE_BEDROCK
  delete env.CLAUDE_CODE_USE_VERTEX
  // Set for the MCP proxy child, and harmless there — but it would stop the
  // CLI's own launcher dead if it leaked into this process's environment.
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

/**
 * Run one message through the CLI.
 *
 * Resolves when the model has finished its turn (tools and all). Rejects with a
 * user-facing message on failure; a resume against a session the CLI has since
 * forgotten is retried once from scratch rather than surfaced as an error.
 */
export async function runClaudeCode(opts: ClaudeCodeRunOptions): Promise<void> {
  const resuming = Boolean(opts.session.id)
  try {
    await runOnce(opts)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // A stale session is recoverable and not worth showing the user: the CLI
    // prunes its session store independently of us, so an id we saved an hour
    // ago may simply be gone.
    if (resuming && !opts.signal?.aborted && /resume|session/i.test(message)) {
      opts.onDebug?.('claude-code-session-reset', { reason: message })
      opts.session.id = null
      await runOnce(opts)
      return
    }
    throw err
  }
}

function runOnce(opts: ClaudeCodeRunOptions): Promise<void> {
  const { command, model, prompt, workspace, session, onText, onDebug, signal } = opts

  // A fresh conversation picks its own id so the first run is already
  // resumable; later runs attach to it.
  const resumeId = session.id
  const sessionArgs = resumeId ? ['--resume', resumeId] : ['--session-id', newSessionId()]

  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose', // the CLI refuses stream-json in print mode without it
    '--include-partial-messages', // token-level text, so the UI streams
    ...containmentArgs(workspace),
    '--system-prompt-file',
    workspace.systemPromptPath,
    '--model',
    model,
    ...sessionArgs
  ]

  onDebug?.('claude-code-spawn', { command, args, cwd: workspace.cwd })

  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspace.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv(),
      // `claude` is a .cmd shim on Windows, which Node cannot exec directly.
      shell: process.platform === 'win32'
    })

    let stderr = ''
    let settled = false
    let resultEvent: CliEvent | null = null
    let sawInit = false

    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (err) reject(err)
      else resolve()
    }

    function onAbort(): void {
      killTree(child)
      // Cancelling is a user action, not a failure — the caller checks the
      // signal and suppresses the error, same as the other backends.
      finish(new Error('Cancelled.'))
    }

    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })

    const stdoutLines = lineSplitter((line) => {
      const evt = parseEvent(line)
      if (!evt) {
        // The CLI prints the occasional plain warning to stdout. Treating that
        // as fatal would abort a working run over a diagnostic.
        onDebug?.('claude-code-stdout', { line: line.slice(0, 500) })
        return
      }

      switch (evt.type) {
        case 'system':
          if (evt.subtype === 'init') {
            sawInit = true
            // Only now is the id confirmed — the CLI may hand back a different
            // one than we asked for (e.g. it forked the session).
            if (evt.session_id) session.id = evt.session_id
            onDebug?.('claude-code-init', {
              sessionId: evt.session_id,
              model: evt.model,
              tools: evt.tools,
              mcpServers: evt.mcp_servers
            })
          }
          break

        case 'stream_event': {
          // Token-level deltas. Thinking deltas are skipped: this is a grocery
          // chat, and the reasoning is noise in the transcript.
          const inner = evt.event
          if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
            if (inner.delta.text) onText(inner.delta.text)
          }
          break
        }

        case 'result':
          // The turn's verdict, plus what it cost. Text already streamed above,
          // so `result` is only read for success/failure here.
          resultEvent = evt
          onDebug?.('claude-code-result', {
            subtype: evt.subtype,
            isError: evt.is_error,
            turns: evt.num_turns,
            durationMs: evt.duration_ms,
            costUsd: evt.total_cost_usd,
            denials: evt.permission_denials
          })
          break

        // `assistant` / `user` carry the consolidated message and the tool
        // results. Both are ignored on purpose: text comes from the deltas
        // above (counting it twice would duplicate it), and tool activity is
        // emitted by the bridge, which has the parsed payload rather than a
        // JSON string.
        default:
          break
      }
    })

    child.stdout.on('data', (d: Buffer) => stdoutLines.push(String(d)))
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 100_000) stderr += String(d)
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        return finish(
          new Error(
            `Couldn't run the Claude Code CLI ("${command}"). Install it with ` +
              '`npm i -g @anthropic-ai/claude-code`, or set the command in Settings → Models.'
          )
        )
      }
      finish(new Error(`Claude Code failed to start: ${err.message}`))
    })

    child.on('close', (code) => {
      stdoutLines.flush()
      if (settled) return

      const detail = stderr.trim().split('\n').slice(-5).join(' ').slice(0, 400)

      if (!sawInit && code !== 0) {
        // Died before a session even opened — almost always auth or a bad flag,
        // and stderr is the only thing that explains which.
        return finish(
          new Error(
            `Claude Code exited before starting (code ${code}). ${detail || 'No output.'} ` +
              'If it needs signing in, run `claude` once in a terminal.'
          )
        )
      }

      if (!resultEvent) {
        return finish(
          new Error(`Claude Code ended without a result (code ${code}). ${detail}`.trim())
        )
      }

      if (resultEvent.is_error || resultEvent.subtype !== 'success') {
        const why =
          typeof resultEvent.result === 'string' && resultEvent.result
            ? resultEvent.result
            : (resultEvent.subtype ?? 'unknown error')
        return finish(new Error(`Claude Code: ${why}`))
      }

      finish()
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })
}

/**
 * Probe for the CLI, for the settings UI.
 *
 * `--version` only: it never opens a session, so detection costs nothing
 * against the subscription and cannot be mistaken for usage.
 */
export function detectClaudeCode(command: string): Promise<ClaudeCodeStatus> {
  return new Promise((resolve) => {
    execFile(
      command,
      ['--version'],
      { timeout: 15_000, env: childEnv(), shell: process.platform === 'win32' },
      (err, stdout) => {
        const version = String(stdout ?? '').trim()
        if (err || !version) {
          resolve({
            ok: false,
            command,
            version: null,
            error:
              (err as NodeJS.ErrnoException | null)?.code === 'ENOENT'
                ? 'Not found on PATH.'
                : (err?.message ?? 'No version reported.')
          })
          return
        }
        resolve({ ok: true, command, version })
      }
    )
  })
}

// ---- process + stream plumbing ---------------------------------------------

/**
 * Kill the child and anything it started.
 *
 * On Windows the child is `cmd.exe` (the .cmd shim needs a shell), so killing
 * it directly would orphan the real CLI process and the MCP proxy under it —
 * they would keep the bridge port open and keep streaming into a cancelled run.
 * `taskkill /T` takes the whole tree.
 */
function killTree(child: { pid?: number; kill: (sig?: NodeJS.Signals) => boolean }): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {
      /* already gone is fine */
    })
    return
  }
  child.kill('SIGTERM')
}

/** Buffer a byte stream into whole lines — chunk boundaries are not line
 *  boundaries, and a half-parsed NDJSON event is worse than a late one. */
function lineSplitter(onLine: (line: string) => void): {
  push: (chunk: string) => void
  flush: () => void
} {
  let buf = ''
  return {
    push(chunk) {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (line.length) onLine(line)
      }
      // A child printing megabytes with no newline must not grow the heap.
      if (buf.length > 2_000_000) {
        onLine(buf)
        buf = ''
      }
    },
    flush() {
      const rest = buf.replace(/\r$/, '')
      buf = ''
      if (rest.length) onLine(rest)
    }
  }
}

/**
 * One NDJSON event from the CLI.
 *
 * Deliberately a single shape with everything optional rather than a union per
 * `type`: the CLI is free to add event types and change payloads, and a union
 * would turn each addition into a compile error over a field we never read.
 */
interface CliEvent {
  type: string
  subtype?: string
  session_id?: string
  model?: string
  tools?: unknown
  mcp_servers?: unknown
  /** `stream_event` only — the raw Anthropic SSE event. */
  event?: { type?: string; delta?: { type?: string; text?: string } }
  /** `result` only. */
  is_error?: boolean
  result?: unknown
  num_turns?: number
  duration_ms?: number
  total_cost_usd?: number
  permission_denials?: unknown[]
}

function parseEvent(line: string): CliEvent | null {
  try {
    const parsed = JSON.parse(line)
    return parsed && typeof parsed === 'object' && typeof parsed.type === 'string' ? parsed : null
  } catch {
    return null
  }
}
