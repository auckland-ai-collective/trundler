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

export function ApprovalModal({ call, onRespond }: Props): JSX.Element {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-title">{VERB[call.name] ?? call.name}</div>
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
