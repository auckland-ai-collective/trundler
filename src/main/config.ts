import { app } from 'electron'
import { join, dirname } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { AppConfig } from '../shared/types.js'

const require = createRequire(import.meta.url)
const MCP_PACKAGE = '@auckland-ai-collective/trundler-mcp'
// Fallback only if the package isn't installed (e.g. running from a dev checkout
// without the dependency). Normal path is resolution from the installed package.
const LEGACY_MCP_PATH = 'D:/Projects/MCP/trundler-mcp/dist/index.js'

/**
 * Locate the trundler-mcp stdio server entry. The package's `exports` map blocks
 * deep imports, so we resolve its package.json (always allowed) and derive
 * dist/index.js from there. Env var wins for overrides / packaged layouts.
 */
function resolveMcpServerPath(): string {
  if (process.env.TRUNDLER_MCP_PATH) return process.env.TRUNDLER_MCP_PATH
  try {
    const pkgJson = require.resolve(`${MCP_PACKAGE}/package.json`)
    const serverPath = join(dirname(pkgJson), 'dist', 'index.js')
    if (existsSync(serverPath)) return serverPath
  } catch {
    /* package not installed — fall through to legacy path */
  }
  return LEGACY_MCP_PATH
}

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
    mcpServerPath: resolveMcpServerPath(),
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
