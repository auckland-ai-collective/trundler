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
        <BrandIcon />
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
          <label className="ctl toggle">
            <input
              type="checkbox"
              checked={config.requireCartApproval}
              onChange={(e) => patch({ requireCartApproval: e.target.checked })}
            />
            <span>
              Ask before changing the cart
              <small>Approve each add/update/remove. Off = the agent updates the cart directly.</small>
            </span>
          </label>
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

/** In-app brand mark — the same cart-with-arrow glyph as the OS app icon. */
function BrandIcon(): JSX.Element {
  return (
    <svg className="brand-icon" width="26" height="26" viewBox="0 0 24 24" aria-label="Trundler">
      <defs>
        <linearGradient id="brandbg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6bd08f" />
          <stop offset="1" stopColor="#3f9e6e" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill="url(#brandbg)" />
      <g transform="translate(3.2 3.4) scale(0.72)" fill="#ffffff">
        <path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2s-.9-2-2-2m10 0c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2s2-.9 2-2s-.9-2-2-2m-8.9-5h7.45c.75 0 1.41-.41 1.75-1.03L21 4.96L19.25 4l-3.7 7H8.53L4.27 2H1v2h2l3.6 7.59l-1.35 2.44C4.52 15.37 5.48 17 7 17h12v-2H7zM12 2l4 4l-4 4l-1.41-1.41L12.17 7H8V5h4.17l-1.59-1.59z" />
      </g>
    </svg>
  )
}
