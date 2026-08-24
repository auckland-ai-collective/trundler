import type { ToolCall } from '../../shared/types.js'

interface Props {
  call: ToolCall
  onRespond: (approved: boolean) => void
}

const VERB: Record<string, string> = {
  cart_add: 'Add to cart',
  cart_update: 'Update cart quantity',
  cart_remove: 'Remove from cart'
}

/** A one-line, plain-English "2 kg" / "3 ea" for a cart call, so the amount and
 *  its unit are legible without parsing the JSON below — a quantity of 2 means
 *  something very different for weighed produce than for a packaged item. */
function amountSummary(args: Record<string, unknown>): string | null {
  const qty = args.quantity
  if (typeof qty !== 'number') return null
  const unit = args.unit === 'Kg' ? 'kg' : 'ea'
  return `${qty} ${unit}`
}

export function ApprovalModal({ call, onRespond }: Props): JSX.Element {
  const amount = amountSummary(call.args)
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">
          {VERB[call.name] ?? call.name}
          {amount ? <span className="modal-amount">{amount}</span> : null}
        </div>
        <div className="modal-body">
          The agent wants to run <code>{call.name}</code>:
          <pre className="modal-args">{JSON.stringify(call.args, null, 2)}</pre>
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={() => onRespond(false)}>
            Deny
          </button>
          <button className="primary" onClick={() => onRespond(true)}>
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
