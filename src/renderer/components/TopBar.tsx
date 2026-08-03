import { useEffect, useState } from 'react'
import type {
  AppConfig,
  AuthStatus,
  BackendId,
  OllamaModelInfo,
  OllamaModelsResult,
  RecommendedModel
} from '../../shared/types.js'

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

type DrawerTab = 'options' | 'models'

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
  const [tab, setTab] = useState<DrawerTab>('options')
  // Drawer edits go to a draft and only persist on Save (Cancel discards).
  const [draft, setDraft] = useState<AppConfig | null>(null)
  // Locally-discovered Ollama models for the picker (null = not loaded yet).
  const [models, setModels] = useState<OllamaModelsResult | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)

  // Immediate persistence for the top-bar quick switches (Provider / Brain).
  function patch(p: Partial<AppConfig>): void {
    onChange({ ...config, ...p })
  }

  function openDrawer(initial: DrawerTab): void {
    setDraft(structuredClone(config))
    setTab(initial)
    setOpen(true)
  }
  function closeDrawer(): void {
    setOpen(false)
    setDraft(null)
  }
  // Each gear targets a tab: click its own tab again to close, else just switch.
  function toggleDrawer(target: DrawerTab): void {
    if (open && tab === target) closeDrawer()
    else if (open) setTab(target)
    else openDrawer(target)
  }
  function dpatch(p: Partial<AppConfig>): void {
    setDraft((d) => (d ? { ...d, ...p } : d))
  }
  function saveDrawer(): void {
    if (draft) {
      // Keep the live Provider/Brain; commit only the drawer-managed fields.
      onChange({
        ...config,
        ollama: draft.ollama,
        anthropic: draft.anthropic,
        mcpServerPath: draft.mcpServerPath,
        requireCartApproval: draft.requireCartApproval,
        debugLogging: draft.debugLogging
      })
    }
    closeDrawer()
  }

  async function loadModels(baseUrl: string): Promise<void> {
    setModelsLoading(true)
    try {
      setModels(await window.trundler.listOllamaModels(baseUrl))
    } finally {
      setModelsLoading(false)
    }
  }

  // Discover models when the Models tab is shown for the Ollama backend.
  useEffect(() => {
    if (open && tab === 'models' && draft?.backend === 'ollama' && !models && !modelsLoading) {
      void loadModels(draft.ollama.baseUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, draft?.backend])

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

        <button
          className={`ghost gear ${open && tab === 'models' ? 'active' : ''}`}
          title="Model settings"
          aria-label="Model settings"
          onClick={() => toggleDrawer('models')}
        >
          ⚙︎
        </button>

        <AuthControl auth={auth} busy={authBusy} onLogin={onLogin} onLogout={onLogout} />

        <button
          className={`ghost gear ${open && tab === 'options' ? 'active' : ''}`}
          title="Trundler options"
          aria-label="Trundler options"
          onClick={() => toggleDrawer('options')}
        >
          ⚙︎
        </button>
        <button className="ghost" onClick={onNewChat}>
          New chat
        </button>
      </div>

      {open && draft ? (
        <div className="settings-drawer">
          <div className="drawer-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'options'}
              className={`drawer-tab ${tab === 'options' ? 'active' : ''}`}
              onClick={() => setTab('options')}
            >
              Trundler options
            </button>
            <button
              role="tab"
              aria-selected={tab === 'models'}
              className={`drawer-tab ${tab === 'models' ? 'active' : ''}`}
              onClick={() => setTab('models')}
            >
              Models
            </button>
          </div>

          {tab === 'options' ? (
            <>
              <Toggle
                label="Ask before changing the cart"
                hint="Approve each add/update/remove. Off = the agent updates the cart directly."
                checked={draft.requireCartApproval}
                onChange={(v) => dpatch({ requireCartApproval: v })}
              />
              <Toggle
                label="Debug logging"
                hint="Record a session log for troubleshooting. Off by default."
                checked={draft.debugLogging}
                onChange={(v) => dpatch({ debugLogging: v })}
              />

              <label className="ctl wide">
                MCP server path
                <input
                  value={draft.mcpServerPath}
                  onChange={(e) => dpatch({ mcpServerPath: e.target.value })}
                />
              </label>
              <div className="drawer-note">MCP path changes take effect on app restart.</div>
            </>
          ) : draft.backend === 'ollama' ? (
            <OllamaModelTab
              draft={draft}
              data={models}
              loading={modelsLoading}
              onSelect={(model) => dpatch({ ollama: { ...draft.ollama, model } })}
              onHostChange={(baseUrl) => dpatch({ ollama: { ...draft.ollama, baseUrl } })}
              onRefresh={() => loadModels(draft.ollama.baseUrl)}
            />
          ) : (
            <>
              <label className="ctl wide">
                Claude model
                <input
                  value={draft.anthropic.model}
                  onChange={(e) => dpatch({ anthropic: { ...draft.anthropic, model: e.target.value } })}
                />
              </label>
              <label className="ctl wide">
                API key
                <input
                  type="password"
                  value={draft.anthropic.apiKey}
                  onChange={(e) => dpatch({ anthropic: { ...draft.anthropic, apiKey: e.target.value } })}
                  placeholder="sk-ant-…"
                />
              </label>
              <div className="drawer-note">
                Claude runs in Anthropic's cloud and uses your API key — separate from your local
                Ollama models.
              </div>
            </>
          )}

          <div className="drawer-actions">
            <button className="ghost" onClick={closeDrawer}>
              Cancel
            </button>
            <button className="primary" onClick={saveDrawer}>
              Save
            </button>
          </div>
        </div>
      ) : null}
    </header>
  )
}

/** The Models tab for the Ollama backend: host, an installed-model picker filtered
 *  by tool-calling capability, and a "recommended to add" list with pull commands. */
function OllamaModelTab({
  draft,
  data,
  loading,
  onSelect,
  onHostChange,
  onRefresh
}: {
  draft: AppConfig
  data: OllamaModelsResult | null
  loading: boolean
  onSelect: (model: string) => void
  onHostChange: (baseUrl: string) => void
  onRefresh: () => void
}): JSX.Element {
  const capable = (data?.installed ?? []).filter((m) => m.supportsTools)
  const others = (data?.installed ?? []).filter((m) => !m.supportsTools)
  // The saved model might not be installed (custom pull, remote host) — still show
  // it as selected so the current choice is never silently lost.
  const selectedMissing =
    draft.ollama.model && !capable.some((m) => m.name === draft.ollama.model)

  return (
    <>
      <label className="ctl wide">
        Ollama host
        <input value={draft.ollama.baseUrl} onChange={(e) => onHostChange(e.target.value)} />
      </label>

      <div className="picker-head">
        <span>Installed models that can call tools</span>
        <button className="link-btn" onClick={onRefresh} disabled={loading}>
          {loading ? 'Detecting…' : 'Refresh'}
        </button>
      </div>

      {loading && !data ? (
        <div className="drawer-note">Detecting local models…</div>
      ) : data && !data.ok ? (
        <div className="msg error compact">
          Couldn't reach Ollama at this host. Is it running? {data.error ? `(${data.error})` : ''}
        </div>
      ) : (
        <div className="model-list">
          {capable.map((m) => (
            <ModelRow
              key={m.name}
              model={m}
              selected={draft.ollama.model === m.name}
              onSelect={() => onSelect(m.name)}
            />
          ))}
          {selectedMissing ? (
            <button className="model-row selected" onClick={() => onSelect(draft.ollama.model)}>
              <span className="model-radio" />
              <span className="model-name">{draft.ollama.model}</span>
              <span className="model-note">current selection</span>
            </button>
          ) : null}
          {capable.length === 0 && !selectedMissing ? (
            <div className="drawer-note">
              No tool-capable models installed. Pull one of the suggestions below.
            </div>
          ) : null}
        </div>
      )}

      {others.length ? (
        <details className="model-others">
          <summary>{others.length} installed model(s) can't call tools</summary>
          <div className="model-list">
            {others.map((m) => (
              <div key={m.name} className="model-row disabled" title="No tool-calling support">
                <span className="model-name">{m.name}</span>
                <span className="model-note">
                  {m.capabilities.includes('vision') ? 'vision only' : 'no tools'}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {data?.recommended.length ? (
        <div className="reco">
          <div className="reco-head">Recommended to add — strong tool-callers</div>
          {data.recommended.map((r) => (
            <RecoRow key={r.name} reco={r} />
          ))}
          <div className="drawer-note">Run the command in a terminal, then Refresh.</div>
        </div>
      ) : null}
    </>
  )
}

function ModelRow({
  model,
  selected,
  onSelect
}: {
  model: OllamaModelInfo
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  return (
    <button className={`model-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <span className="model-radio" />
      <span className="model-name">{model.name}</span>
      {model.capabilities.includes('thinking') ? <span className="model-badge">🧠</span> : null}
      <span className="model-note">{formatSize(model.sizeBytes)}</span>
    </button>
  )
}

function RecoRow({ reco }: { reco: RecommendedModel }): JSX.Element {
  const [copied, setCopied] = useState(false)
  function copy(): void {
    void navigator.clipboard.writeText(`ollama pull ${reco.name}`).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="reco-row">
      <div className="reco-main">
        <span className="model-name">{reco.name}</span>
        <span className="model-note">{reco.size}</span>
      </div>
      <div className="reco-note">{reco.note}</div>
      <button className="link-btn" onClick={copy} title={`ollama pull ${reco.name}`}>
        {copied ? 'Copied' : 'Copy pull'}
      </button>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (!bytes) return ''
  const gb = bytes / 1e9
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`
}

/** A pill toggle switch (used instead of checkboxes for on/off settings). */
function Toggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <div className="switch-row">
      <span className="switch-text">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" />
      </button>
    </div>
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
