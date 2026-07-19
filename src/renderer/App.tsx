import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentEvent, AppConfig, AuthStatus, Cart, ToolCall } from '../shared/types.js'
import { CART_TOOLS, PRODUCT_TOOLS, extractProducts, type Block } from './blocks.js'
import { renderMarkdown } from './lib/markdown.js'
import { TopBar } from './components/TopBar.js'
import { Composer } from './components/Composer.js'
import { CartPanel } from './components/CartPanel.js'
import { ProductGrid } from './components/ProductGrid.js'
import { ApprovalModal } from './components/ApprovalModal.js'

let counter = 0
const uid = (): string => `b${++counter}`

export function App(): JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [toolCount, setToolCount] = useState(0)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [running, setRunning] = useState(false)
  const [approval, setApproval] = useState<ToolCall | null>(null)
  const [cart, setCart] = useState<Cart | null>(null)
  const [cartNote, setCartNote] = useState<string | null>(null)
  const [cartLoading, setCartLoading] = useState(false)
  const [cartBusy, setCartBusy] = useState(false)
  const [cartUpdatedAt, setCartUpdatedAt] = useState<string | null>(null)
  const [debug, setDebug] = useState<{ enabled: boolean; path: string }>({ enabled: false, path: '' })
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState<string | null>(null)

  // Id of the assistant block currently receiving streamed text (null = none open).
  const openAssistant = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Whether the message list is pinned to the bottom. While true, new content
  // auto-scrolls into view; once the user scrolls up, we leave their view alone.
  const stickToBottom = useRef(true)
  const configRef = useRef<AppConfig | null>(null)
  configRef.current = config

  useEffect(() => {
    window.trundler.getConfig().then(setConfig)
    window.trundler.listTools().then((t) => setToolCount(t.length))
    window.trundler.getDebugInfo().then(setDebug)
  }, [])

  useEffect(() => {
    const off = window.trundler.onAgentEvent(handleEvent)
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!stickToBottom.current) return
    const el = scrollRef.current
    // Instant (not smooth): streamed tokens update this many times a second, and
    // a smooth animation never settles — plus its mid-flight scroll events would
    // read as "user scrolled up" and unpin us.
    el?.scrollTo({ top: el.scrollHeight })
  }, [blocks])

  // Re-evaluate the pin on every user scroll. Anything but flush-against the
  // bottom (small slack for sub-pixel rounding) counts as "reading up".
  function onMessagesScroll(): void {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  // Refresh login status whenever the active provider changes — and once login
  // is verified, load the cart so it reflects the real account on startup.
  useEffect(() => {
    const provider = config?.defaultProvider
    if (!provider) return
    window.trundler.authStatus(provider).then((s) => {
      setAuth(s)
      if (s.isLoggedIn) refreshCart(provider)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.defaultProvider])

  function append(b: Block): void {
    setBlocks((prev) => [...prev, b])
  }

  function handleEvent(evt: AgentEvent): void {
    switch (evt.type) {
      case 'text': {
        if (!openAssistant.current) {
          const id = uid()
          openAssistant.current = id
          setBlocks((prev) => [...prev, { kind: 'assistant', id, text: evt.delta }])
        } else {
          const id = openAssistant.current
          setBlocks((prev) =>
            prev.map((b) => (b.id === id && b.kind === 'assistant' ? { ...b, text: b.text + evt.delta } : b))
          )
        }
        break
      }
      case 'tool-call': {
        openAssistant.current = null
        append({ kind: 'tool', id: evt.call.id, name: evt.call.name, args: evt.call.args, status: 'running' })
        break
      }
      case 'tool-result': {
        setBlocks((prev) =>
          prev.map((b) =>
            b.id === evt.id && b.kind === 'tool' ? { ...b, status: evt.ok ? 'ok' : 'error' } : b
          )
        )
        if (evt.ok && PRODUCT_TOOLS.has(evt.name)) {
          const products = extractProducts(evt.data)
          if (products?.length) {
            const query = (evt.data as { query?: string })?.query
            append({ kind: 'products', id: uid(), provider: evt.provider, query, products })
          }
        }
        if (CART_TOOLS.has(evt.name)) refreshCart(evt.provider)
        break
      }
      case 'approval': {
        setApproval(evt.call)
        break
      }
      case 'error': {
        openAssistant.current = null
        append({ kind: 'error', id: uid(), text: evt.message })
        break
      }
      case 'done': {
        openAssistant.current = null
        setRunning(false)
        break
      }
    }
  }

  async function refreshCart(provider: string): Promise<void> {
    setCartLoading(true)
    try {
      const res = await window.trundler.mcpCall('cart_get', { provider })
      if (res.ok && res.data && typeof res.data === 'object' && 'items' in (res.data as object)) {
        setCart(res.data as Cart)
        setCartNote(null)
        setCartUpdatedAt(new Date().toLocaleTimeString())
      } else {
        const msg = (res.data as { error?: string })?.error
        setCartNote(msg ? shortError(msg) : 'Could not read cart.')
      }
    } finally {
      setCartLoading(false)
    }
  }

  function send(text: string): void {
    // Sending is an explicit "take me to the conversation" action — re-pin so
    // the user's message and the incoming reply scroll into view.
    stickToBottom.current = true
    append({ kind: 'user', id: uid(), text })
    openAssistant.current = null
    setRunning(true)
    window.trundler.send(text)
  }

  function onApprovalRespond(approved: boolean): void {
    if (approval) window.trundler.respondApproval(approval.id, approved)
    setApproval(null)
  }

  // A suggested-prompt chip was clicked: send it — but only once logged in
  // (for providers that need it), otherwise nudge the user to sign in first.
  function onPickSuggestion(text: string): void {
    if (auth?.requiresLogin && !auth.isLoggedIn) {
      setAuthMessage(`Log in to ${config!.defaultProvider} first, then I can shop for you.`)
      window.setTimeout(() => setAuthMessage(null), 4000)
      return
    }
    send(text)
  }

  // Cart mutations initiated directly from the UI (product grid, cart panel).
  // These bypass the agent approval gate on purpose: the user is performing the
  // action themselves, so a second confirmation would be redundant.
  async function mutateCart(
    tool: string,
    args: Record<string, unknown>,
    failMsg: string,
    provider: string
  ): Promise<void> {
    setCartBusy(true)
    try {
      const res = await window.trundler.mcpCall(tool, args)
      if (!res.ok) {
        const msg = (res.data as { error?: string })?.error ?? failMsg
        append({ kind: 'error', id: uid(), text: msg })
      }
      await refreshCart(provider)
    } finally {
      setCartBusy(false)
    }
  }

  function onAddToCart(sku: string, provider: string): void {
    // "cart_add" sets an absolute quantity (it's not additive), so adding an
    // item that's already in the cart would reset it to 1. Increment instead.
    const existing = cart?.items.find((it) => it.sku === sku)
    if (existing) {
      const quantity = (existing.quantity ?? 1) + 1
      void mutateCart('cart_update', { sku, quantity, unit: existing.unit, provider }, 'Add failed', provider)
    } else {
      void mutateCart('cart_add', { sku, quantity: 1, provider }, 'Add failed', provider)
    }
  }

  function onRemoveFromCart(sku: string, unit: string | undefined, provider: string): void {
    void mutateCart('cart_remove', { sku, unit, provider }, 'Remove failed', provider)
  }

  function onChangeQuantity(
    sku: string,
    quantity: number,
    unit: string | undefined,
    provider: string
  ): void {
    // cart_update rejects quantity <= 0 — removing is the intended outcome there.
    if (quantity <= 0) {
      onRemoveFromCart(sku, unit, provider)
      return
    }
    void mutateCart('cart_update', { sku, quantity, unit, provider }, 'Update failed', provider)
  }

  function onConfigChange(next: AppConfig): void {
    setConfig(next)
    // Re-read debug state so the footer appears/disappears with the setting.
    window.trundler.setConfig(next).then(() => window.trundler.getDebugInfo().then(setDebug))
  }

  function onNewChat(): void {
    window.trundler.resetChat()
    setBlocks([])
    openAssistant.current = null
  }

  async function onLogin(): Promise<void> {
    const p = config!.defaultProvider
    setAuthBusy(true)
    setAuthMessage(
      'A browser window is opening — complete sign-in there. First-time sign-in may download a browser (~150 MB), which can take a minute.'
    )
    try {
      const status = await window.trundler.authLogin(p)
      setAuth(status)
      if (status.error) setAuthMessage(`Login failed: ${status.error}`)
      else if (status.isLoggedIn) {
        setAuthMessage(null)
        refreshCart(p)
      } else setAuthMessage('Sign-in was not completed. Click Log in to try again.')
    } catch (err) {
      setAuthMessage(`Login failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAuthBusy(false)
    }
  }

  async function onLogout(): Promise<void> {
    const p = config!.defaultProvider
    setAuthBusy(true)
    try {
      setAuth(await window.trundler.authLogout(p))
      setCart(null)
      setCartUpdatedAt(null)
      setCartNote(null)
    } finally {
      setAuthBusy(false)
    }
  }

  // cart_get carries no image, so map SKU -> image from products seen in the
  // session's search grids and use it to decorate cart lines.
  const skuImages = useMemo(() => {
    const map: Record<string, string> = {}
    for (const b of blocks) {
      if (b.kind !== 'products') continue
      for (const p of b.products) {
        if (p.sku && p.image && !map[p.sku]) map[p.sku] = p.image
      }
    }
    return map
  }, [blocks])

  if (!config) return <div className="loading">Starting Trundler…</div>

  const provider = config.defaultProvider
  const canAdd = provider === 'countdown'

  return (
    <div className="app">
      <TopBar
        config={config}
        toolCount={toolCount}
        auth={auth}
        authBusy={authBusy}
        onChange={onConfigChange}
        onNewChat={onNewChat}
        onLogin={onLogin}
        onLogout={onLogout}
      />

      {authMessage ? <div className="auth-banner">{authMessage}</div> : null}

      <div className="main">
        <div className="chat">
          <div className="messages" ref={scrollRef} onScroll={onMessagesScroll}>
            {blocks.length === 0 ? <EmptyState provider={provider} onPick={onPickSuggestion} /> : null}
            {blocks.map((b) => (
              <BlockView key={b.id} block={b} canAdd={canAdd} onAdd={onAddToCart} />
            ))}
          </div>
          <Composer running={running} onSend={send} onCancel={() => window.trundler.cancel()} />
        </div>

        <CartPanel
          cart={cart}
          provider={provider}
          note={cartNote}
          images={skuImages}
          loading={cartLoading}
          busy={cartBusy}
          updatedAt={cartUpdatedAt}
          onRefresh={() => refreshCart(provider)}
          onRemove={onRemoveFromCart}
          onChangeQty={onChangeQuantity}
        />
      </div>

      {debug.enabled ? (
        <footer className="debug-bar">
          <span className="debug-dot" />
          Debug logging on · {config.backend === 'anthropic' ? config.anthropic.model : config.ollama.model}
          <button className="debug-link" onClick={() => window.trundler.openLogs()} title={debug.path}>
            open logs
          </button>
        </footer>
      ) : null}

      {approval ? <ApprovalModal call={approval} onRespond={onApprovalRespond} /> : null}
    </div>
  )
}

function BlockView({
  block,
  canAdd,
  onAdd
}: {
  block: Block
  canAdd: boolean
  onAdd: (sku: string, provider: string) => void
}): JSX.Element {
  switch (block.kind) {
    case 'user':
      return <div className="msg user">{block.text}</div>
    case 'assistant':
      return (
        <div
          className="msg assistant"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(block.text || '…') }}
        />
      )
    case 'tool':
      return (
        <div className={`tool-chip ${block.status}`}>
          <span className="tool-spinner" />
          <code>{block.name}</code>
          <span className="tool-args">{summariseArgs(block.args)}</span>
        </div>
      )
    case 'products':
      return (
        <ProductGrid
          products={block.products}
          provider={block.provider}
          query={block.query}
          canAdd={canAdd && block.provider === 'countdown'}
          onAdd={onAdd}
        />
      )
    case 'error':
      return <div className="msg error">⚠︎ {block.text}</div>
  }
}

const SUGGESTIONS = [
  'Find the cheapest jasmine rice',
  'What eggs are on special?',
  'Compare milk prices across chains'
]

function EmptyState({
  provider,
  onPick
}: {
  provider: string
  onPick: (text: string) => void
}): JSX.Element {
  return (
    <div className="empty">
      <div className="empty-title">What are we shopping for?</div>
      <div className="empty-hints">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="hint-chip" onClick={() => onPick(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="empty-sub">Provider: {provider}</div>
    </div>
  )
}

function summariseArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(([k]) => k !== 'provider')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  return parts.join(', ')
}

function shortError(msg: string): string {
  return msg.length > 140 ? `${msg.slice(0, 140)}…` : msg
}
