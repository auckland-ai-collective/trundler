import type { Backend, ChatMessage, ToolCall, ToolDef } from './types.js'

/** Tools that mutate a real cart and therefore require user approval. */
export const MUTATING_TOOLS = new Set(['cart_add', 'cart_update', 'cart_remove'])

const MAX_TURNS = 12

export interface LoopHandlers {
  onText(delta: string): void
  onToolCall(call: ToolCall): void
  onToolResult(call: ToolCall, ok: boolean, data: unknown): void
  requestApproval(call: ToolCall): Promise<boolean>
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
}

/**
 * Run the agent until it produces a final answer with no further tool calls.
 * `history` is mutated in place so the caller can persist the conversation.
 */
export async function runAgent(
  backend: Backend,
  system: string,
  history: ChatMessage[],
  tools: ToolDef[],
  handlers: LoopHandlers,
  signal?: AbortSignal
): Promise<void> {
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal?.aborted) return

    const result = await backend.run(system, history, tools, handlers.onText, signal)
    history.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls })

    if (!result.toolCalls.length) return // final answer

    for (const call of result.toolCalls) {
      handlers.onToolCall(call)

      if (MUTATING_TOOLS.has(call.name)) {
        const approved = await handlers.requestApproval(call)
        if (!approved) {
          const denied = { error: 'The user declined this action.' }
          pushToolResult(history, call, denied)
          handlers.onToolResult(call, false, denied)
          continue
        }
      }

      try {
        const data = await handlers.callTool(call.name, call.args)
        const ok = !(data && typeof data === 'object' && 'error' in (data as object))
        pushToolResult(history, call, data)
        handlers.onToolResult(call, ok, data)
      } catch (err) {
        const payload = { error: err instanceof Error ? err.message : String(err) }
        pushToolResult(history, call, payload)
        handlers.onToolResult(call, false, payload)
      }
    }
  }

  throw new Error('Reached the tool-call limit without a final answer.')
}

function pushToolResult(history: ChatMessage[], call: ToolCall, data: unknown): void {
  history.push({
    role: 'tool',
    content: typeof data === 'string' ? data : JSON.stringify(data),
    toolCallId: call.id,
    toolName: call.name
  })
}
