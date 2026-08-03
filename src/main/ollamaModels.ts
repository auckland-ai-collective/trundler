import type { OllamaModelInfo, OllamaModelsResult, RecommendedModel } from '../shared/types.js'

/**
 * Tool-capable models worth suggesting as downloads. Curated (not auto-generated)
 * because "does tool-calling well" is a quality judgement, not just a capability
 * flag — Ollama's registry has many models that technically accept tools but
 * choose them poorly. Anything the user already has is filtered out before we
 * surface this list.
 */
const RECOMMENDED: RecommendedModel[] = [
  { name: 'qwen3:30b-a3b', size: '~18 GB', note: 'MoE — near-32B smarts at high speed; excellent tool-caller' },
  { name: 'qwen3:14b', size: '9.3 GB', note: 'Strong all-round agentic model; the sensible default' },
  { name: 'qwen3:8b', size: '~5 GB', note: 'Fast and light, still calls tools reliably' },
  { name: 'mistral-small3.2:24b', size: '~14 GB', note: 'Function-calling hardened in 3.2; very dependable' },
  { name: 'llama3.1:8b', size: '4.9 GB', note: 'Quick, modest fallback for lower-spec machines' }
]

interface TagsResponse {
  models?: Array<{ name?: string; model?: string; size?: number }>
}
interface ShowResponse {
  capabilities?: string[]
}

async function getJson<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const resp = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal
  })
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
  return (await resp.json()) as T
}

/**
 * List the models installed in the local Ollama, each tagged with whether it can
 * call tools. Capability comes from `/api/show` (`capabilities` includes "tools"
 * only when the model ships a tool template) — the authoritative signal, rather
 * than guessing from the model name.
 */
export async function listOllamaModels(baseUrl: string): Promise<OllamaModelsResult> {
  const base = baseUrl.replace(/\/$/, '')
  const installedNames = new Set<string>()
  try {
    const tags = await getJson<TagsResponse>(`${base}/api/tags`)
    const models = tags.models ?? []

    const installed: OllamaModelInfo[] = await Promise.all(
      models.map(async (m) => {
        const name = m.name ?? m.model ?? ''
        installedNames.add(name)
        let capabilities: string[] = []
        try {
          const show = await getJson<ShowResponse>(`${base}/api/show`, { model: name })
          capabilities = show.capabilities ?? []
        } catch {
          /* older Ollama or a model without a modelfile — leave capabilities empty */
        }
        return {
          name,
          sizeBytes: m.size ?? 0,
          capabilities,
          supportsTools: capabilities.includes('tools')
        }
      })
    )

    // Tool-capable first, then by name, so the useful models sort to the top.
    installed.sort((a, b) => {
      if (a.supportsTools !== b.supportsTools) return a.supportsTools ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return {
      ok: true,
      installed,
      recommended: RECOMMENDED.filter((r) => !installedNames.has(r.name))
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      installed: [],
      recommended: RECOMMENDED.filter((r) => !installedNames.has(r.name))
    }
  }
}
