import { useState } from 'react'
import type { AppConfig, AuthStatus, BackendId } from '../../shared/types.js'

interface Props {
  config: AppConfig
  toolCount: number
  auth: AuthStatus | null
  authBusy: boolean
  onChange: (cfg: AppConfig) => void
  onNewChat: () => void
  onLogin: () => void
  onLogout: () => void
}

const PROVIDERS = [
  { id: 'countdown', label: 'Countdown' },
  { id: 'newworld', label: 'New World' },
  { id: 'paknsave', label: "Pak'nSave" }
]

export function TopBar({
  config,
  toolCount,
  auth,
  authBusy,
  onChange,
  onNewChat,
  onLogin,
  onLogout
}: Props): JSX.Element {
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

        <AuthControl auth={auth} busy={authBusy} onLogin={onLogin} onLogout={onLogout} />

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

function AuthControl({
  auth,
  busy,
  onLogin,
  onLogout
}: {
  auth: AuthStatus | null
  busy: boolean
  onLogin: () => void
  onLogout: () => void
}): JSX.Element | null {
  if (!auth || !auth.requiresLogin) {
    return <span className="auth-chip anon" title="This provider needs no login">no login needed</span>
  }

  if (busy) {
    return (
      <span className="auth-chip busy">
        <span className="auth-dot pending" />
        Working…
      </span>
    )
  }

  if (auth.isLoggedIn) {
    return (
      <span className="auth-chip in" title={auth.email ?? 'Signed in'}>
        <span className="auth-dot ok" />
        {auth.email ? shortEmail(auth.email) : 'Signed in'}
        <button className="auth-btn" onClick={onLogout}>
          Log out
        </button>
      </span>
    )
  }

  return (
    <span className="auth-chip out" title="Not signed in">
      <span className="auth-dot down" />
      Signed out
      <button className="auth-btn primary" onClick={onLogin}>
        Log in
      </button>
    </span>
  )
}

function shortEmail(email: string): string {
  return email.length > 22 ? `${email.slice(0, 20)}…` : email
}
