import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import type { AppConfig } from '../shared/types.js'

const DEFAULT_MCP_PATH = 'D:/Projects/MCP/trundler-mcp/dist/index.js'

function defaults(): AppConfig {
  return {
    backend: (process.env.TRUNDLER_BACKEND as AppConfig['backend']) || 'ollama',
    ollama: {
      baseUrl: process.env.OLLAMA_HOST || 'http://localhost:11434',
      // llama3.1:8b and qwen3:14b both support native tool-calling. 8b is faster
      // to load for dev; switch to qwen3:14b in the UI for stronger tool use.
      model: process.env.TRUNDLER_OLLAMA_MODEL || 'llama3.1:8b'
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: process.env.TRUNDLER_ANTHROPIC_MODEL || 'claude-sonnet-4-6'
    },
    mcpServerPath: process.env.TRUNDLER_MCP_PATH || DEFAULT_MCP_PATH,
    defaultProvider: process.env.TRUNDLER_PROVIDER || 'countdown'
  }
}

function configPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'config.json')
}

export function loadConfig(): AppConfig {
  const base = defaults()
  try {
    const path = configPath()
    if (existsSync(path)) {
      const saved = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AppConfig>
      return {
        ...base,
        ...saved,
        ollama: { ...base.ollama, ...saved.ollama },
        anthropic: { ...base.anthropic, ...saved.anthropic }
      }
    }
  } catch (err) {
    console.error('[config] failed to load, using defaults:', err)
  }
  return base
}

export function saveConfig(cfg: AppConfig): void {
  try {
    writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8')
  } catch (err) {
    console.error('[config] failed to save:', err)
  }
}
