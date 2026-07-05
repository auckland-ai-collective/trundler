// Neutral, backend-agnostic agent primitives. Both the Ollama and Anthropic
// backends convert these to/from their wire formats, so the loop stays shared.

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  toolName?: string
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface AssistantTurn {
  content: string
  toolCalls: ToolCall[]
}

/** A pluggable LLM backend. One turn = one model response (text + tool calls). */
export interface Backend {
  id: string
  label: string
  run(
    system: string,
    messages: ChatMessage[],
    tools: ToolDef[],
    onDelta: (text: string) => void,
    signal?: AbortSignal
  ): Promise<AssistantTurn>
}
