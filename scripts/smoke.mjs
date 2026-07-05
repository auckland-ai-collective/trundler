// Headless end-to-end check: connect to trundler-mcp over stdio, run one
// Ollama tool-calling turn, execute any tool call, and print the transcript.
// Verifies both halves of the app (MCP data layer + local agent loop) without
// launching the Electron GUI.
//
//   node scripts/smoke.mjs "find jasmine rice"
//
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const MCP_PATH = process.env.TRUNDLER_MCP_PATH || 'D:/Projects/MCP/trundler-mcp/dist/index.js'
const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434'
const MODEL = process.env.TRUNDLER_OLLAMA_MODEL || 'llama3.1:8b'
const PROVIDER = process.env.TRUNDLER_PROVIDER || 'countdown'
const PROMPT = process.argv[2] || 'Find jasmine rice and tell me the cheapest option.'

const log = (...a) => console.log(...a)

// Mirrors src/main/agent/system.ts so the smoke test exercises the real prompt.
// Keep in sync with that file.
function buildSystemPrompt(mcpInstructions, defaultProvider) {
  const base = [
    'You are Trundler, a friendly, efficient grocery-shopping companion.',
    'You help the user plan meals, find products, compare prices across chains, and',
    'build a cart — using the trundler tools as your only source of live grocery data.',
    '',
    'Providers you can shop:',
    `- "countdown" (Countdown / Woolworths NZ) — the default provider (${defaultProvider}).`,
    '- "newworld" (New World) and "paknsave" (Pak\'nSave) — anonymous browsing only.',
    '',
    'Choosing the right product tool:',
    '- To find a SPECIFIC item (by name/keyword), always use `search_products` with a',
    '  `query`. To find that item specifically ON SPECIAL, use `search_products` with',
    '  `query` AND `specialsOnly: true` — e.g. "specials on eggs" →',
    '  search_products { query: "eggs", specialsOnly: true }.',
    '- `get_specials` returns ALL current specials store-wide and takes NO keyword. Never',
    '  pass a `query`/keyword to it — it will be ignored and you will get unrelated items.',
    '  Only use `get_specials` when the user wants to browse specials generally.',
    '- `browse_products` is for browsing a whole department, not for keyword lookups.',
    '',
    'Accuracy:',
    '- Only present items that genuinely match what the user asked for. If a search',
    '  returns nothing relevant, say so plainly — never relabel unrelated products.'
  ].join('\n')
  return mcpInstructions.trim()
    ? `${base}\n\n--- Product-listing format (from trundler) ---\n${mcpInstructions.trim()}`
    : base
}

async function main() {
  log(`\n=== 1. MCP connect (${MCP_PATH}) ===`)
  const transport = new StdioClientTransport({
    command: 'node',
    args: [MCP_PATH],
    stderr: 'inherit'
  })
  const client = new Client({ name: 'trundler-smoke', version: '0.1.0' }, { capabilities: {} })
  await client.connect(transport)

  const instructions = client.getInstructions?.() ?? ''
  const { tools } = await client.listTools()
  log(`connected · ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`)
  log(`server instructions: ${instructions ? `${instructions.length} chars` : '(none)'}`)

  const toolDefs = tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.inputSchema && t.inputSchema.type ? t.inputSchema : { type: 'object', properties: {} }
    }
  }))

  log(`\n=== 2. Ollama tool loop (${MODEL}) ===`)
  const system = buildSystemPrompt(instructions, PROVIDER)
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: PROMPT }
  ]
  log(`user: ${PROMPT}`)

  for (let turn = 0; turn < 5; turn++) {
    const res = await ollamaChat(messages, toolDefs)
    if (res.content) log(`assistant: ${res.content}`)
    if (!res.tool_calls?.length) {
      log('\n=== done (final answer, no more tool calls) ===')
      break
    }
    messages.push({ role: 'assistant', content: res.content || '', tool_calls: res.tool_calls })
    for (const tc of res.tool_calls) {
      const name = tc.function.name
      const args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments
      log(`→ tool_call: ${name}(${JSON.stringify(args)})`)
      let out
      try {
        const result = await client.callTool({ name, arguments: args })
        out = parseResult(result)
      } catch (err) {
        out = { error: String(err?.message || err) }
      }
      const preview = JSON.stringify(out).slice(0, 300)
      log(`← result: ${preview}${preview.length >= 300 ? '…' : ''}`)
      messages.push({ role: 'tool', content: JSON.stringify(out), tool_name: name })
    }
  }

  await client.close()
  log('\nSmoke test complete.')
  process.exit(0)
}

async function ollamaChat(messages, tools) {
  const resp = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, stream: false, messages, tools, options: { temperature: 0.4 } })
  })
  if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${await resp.text()}`)
  const json = await resp.json()
  return json.message ?? {}
}

function parseResult(result) {
  const content = result?.content
  if (Array.isArray(content)) {
    const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return result
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err)
  process.exit(1)
})
