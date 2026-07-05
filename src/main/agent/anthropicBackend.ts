import type { AssistantTurn, Backend, ChatMessage, ToolCall, ToolDef } from './types.js'
import { readLines } from './stream.js'

/**
 * Claude via the Anthropic Messages API (streaming SSE, with tool use).
 * Grocery I/O still happens locally through the MCP; only inference is cloud.
 */
export class AnthropicBackend implements Backend {
  id = 'anthropic'
  label: string

  constructor(
    private apiKey: string,
    private model: string
  ) {
    this.label = `Claude · ${model}`
  }

  async run(
    system: string,
    messages: ChatMessage[],
    tools: ToolDef[],
    onDelta: (text: string) => void,
    signal?: AbortSignal
  ): Promise<AssistantTurn> {
    if (!this.apiKey) throw new Error('No Anthropic API key set (Settings → API key).')

    const body = {
      model: this.model,
      max_tokens: 2048,
      system,
      messages: toAnthropicMessages(messages),
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      })),
      stream: true
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal
    })

    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      throw new Error(`Anthropic ${resp.status}: ${detail || resp.statusText}`)
    }

    let content = ''
    const toolCalls: ToolCall[] = []
    // Track in-flight tool_use blocks by content-block index.
    const partials = new Map<number, { id: string; name: string; json: string }>()

    for await (const line of readLines(resp.body, signal)) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue

      let evt: AnthropicEvent
      try {
        evt = JSON.parse(payload)
      } catch {
        continue
      }

      if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
        partials.set(evt.index!, {
          id: evt.content_block.id!,
          name: evt.content_block.name!,
          json: ''
        })
      } else if (evt.type === 'content_block_delta') {
        if (evt.delta?.type === 'text_delta' && evt.delta.text) {
          content += evt.delta.text
          onDelta(evt.delta.text)
        } else if (evt.delta?.type === 'input_json_delta') {
          const p = partials.get(evt.index!)
          if (p) p.json += evt.delta.partial_json ?? ''
        }
      } else if (evt.type === 'content_block_stop') {
        const p = partials.get(evt.index!)
        if (p) {
          toolCalls.push({ id: p.id, name: p.name, args: safeJson(p.json) })
          partials.delete(evt.index!)
        }
      } else if (evt.type === 'error') {
        throw new Error(`Anthropic: ${evt.error?.message ?? 'stream error'}`)
      }
    }

    return { content, toolCalls }
  }
}

interface AnthropicEvent {
  type: string
  index?: number
  content_block?: { type: string; id?: string; name?: string }
  delta?: { type: string; text?: string; partial_json?: string }
  error?: { message?: string }
}

function toAnthropicMessages(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: m.content }] })
    } else if (m.role === 'assistant') {
      const blocks: unknown[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const c of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args })
      }
      out.push({ role: 'assistant', content: blocks })
    } else if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }]
      })
    }
  }
  return out
}

function safeJson(s: string): Record<string, unknown> {
  if (!s.trim()) return {}
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}
