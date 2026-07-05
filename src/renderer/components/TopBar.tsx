import { useState } from 'react'
import type { AppConfig, BackendId } from '../../shared/types.js'

interface Props {
  config: AppConfig
  toolCount: number
  onChange: (cfg: AppConfig) => void
  onNewChat: () => void
}

const PROVIDERS = [
  { id: 'countdown', label: 'Countdown' },
  { id: 'newworld', label: 'New World' },
  { id: 'paknsave', label: "Pak'nSave" }
]

export function TopBar({ config, toolCount, onChange, onNewChat }: Props): JSX.Element {
  const [open, setOpen] = useState(false)

  function patch(p: Partial<AppConfig>): void {
    onChange({ ...config, ...p })
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">🛒</span>
        <span className="brand-name">Trundler</span>
        <span className={`mcp-dot ${toolCount ? 'ok' : 'down'}`} title={`${toolCount} MCP tools`} />
      </div>

      <div className="topbar-controls">
        <label className="ctl">
          Provider
          <select value={config.defaultProvider} onChange={(e) => patch({ defaultProvider: e.target.value })}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="ctl">
          Brain
          <select
            value={config.backend}
            onChange={(e) => patch({ backend: e.target.value as BackendId })}
          >
            <option value="ollama">Ollama (local)</option>
            <option value="anthropic">Claude (cloud)</option>
          </select>
        </label>

        <button className="ghost" onClick={() => setOpen((v) => !v)}>
          ⚙︎
        </button>
        <button className="ghost" onClick={onNewChat}>
          New chat
        </button>
      </div>

      {open ? (
        <div className="settings-drawer">
          {config.backend === 'ollama' ? (
            <>
              <label className="ctl wide">
                Ollama model
                <input
                  value={config.ollama.model}
                  onChange={(e) => patch({ ollama: { ...config.ollama, model: e.target.value } })}
                  placeholder="llama3.1:8b"
                />
              </label>
              <label className="ctl wide">
                Ollama host
                <input
                  value={config.ollama.baseUrl}
                  onChange={(e) => patch({ ollama: { ...config.ollama, baseUrl: e.target.value } })}
                />
              </label>
            </>
          ) : (
            <>
              <label className="ctl wide">
                Claude model
                <input
                  value={config.anthropic.model}
                  onChange={(e) =>
                    patch({ anthropic: { ...config.anthropic, model: e.target.value } })
                  }
                />
              </label>
              <label className="ctl wide">
                API key
                <input
                  type="password"
                  value={config.anthropic.apiKey}
                  onChange={(e) =>
                    patch({ anthropic: { ...config.anthropic, apiKey: e.target.value } })
                  }
                  placeholder="sk-ant-…"
                />
              </label>
            </>
          )}
          <label className="ctl wide">
            MCP server path
            <input
              value={config.mcpServerPath}
              onChange={(e) => patch({ mcpServerPath: e.target.value })}
            />
          </label>
          <div className="drawer-note">MCP path changes take effect on app restart.</div>
        </div>
      ) : null}
    </header>
  )
}
