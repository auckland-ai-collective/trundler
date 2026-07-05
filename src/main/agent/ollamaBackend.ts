import { randomUUID } from 'node:crypto'
import type { AssistantTurn, Backend, ChatMessage, ToolCall, ToolDef } from './types.js'
import { readLines } from './stream.js'

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> }
}

interface OllamaChunk {
  message?: { content?: string; tool_calls?: OllamaToolCall[] }
  done?: boolean
  error?: string
}

/** Local model via the Ollama /api/chat endpoint (streaming, with tool-calling). */
export class OllamaBackend implements Backend {
  id = 'ollama'
  label: string

  constructor(
    private baseUrl: string,
    private model: string
  ) {
    this.label = `Ollama · ${model}`
  }

  async run(
    system: string,
    messages: ChatMessage[],
    tools: ToolDef[],
    onDelta: (text: string) => void,
    signal?: AbortSignal
  ): Promise<AssistantTurn> {
    const body = {
      model: this.model,
      stream: true,
      messages: toOllamaMessages(system, messages),
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
      })),
      options: { temperature: 0.4 }
    }

    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      throw new Error(`Ollama ${resp.status}: ${detail || resp.statusText}`)
    }

    let content = ''
    const toolCalls: ToolCall[] = []

    for await (const line of readLines(resp.body, signal)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let chunk: OllamaChunk
      try {
        chunk = JSON.parse(trimmed)
      } catch {
        continue
      }
      if (chunk.error) throw new Error(`Ollama: ${chunk.error}`)

      const piece = chunk.message?.content
      if (piece) {
        content += piece
        onDelta(piece)
      }
      const calls = chunk.message?.tool_calls
      if (calls?.length) {
        for (const c of calls) {
          toolCalls.push({
            id: `call_${randomUUID()}`,
            name: c.function.name,
            args: normaliseArgs(c.function.arguments)
          })
        }
      }
      if (chunk.done) break
    }

    return { content, toolCalls }
  }
}

function toOllamaMessages(system: string, messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({
        role: 'assistant',
        content: m.content || '',
        tool_calls: m.toolCalls.map((c) => ({
          function: { name: c.name, arguments: c.args }
        }))
      })
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', content: m.content, tool_name: m.toolName })
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  return out
}

/** Ollama usually returns arguments as an object, but be defensive about strings. */
function normaliseArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object') return args as Record<string, unknown>
  if (typeof args === 'string') {
    try {
      return JSON.parse(args)
    } catch {
      return {}
    }
  }
  return {}
}
