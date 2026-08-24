import { useState } from 'react'
import { clampQty, formatQty, stepQty, unitLabel, type PricingUnit } from '../blocks.js'

interface Props {
  quantity: number
  unit: PricingUnit
  /** Units the user may pick between. A single entry renders as a static label
   *  (nothing to choose), two or more as a segmented toggle. */
  units: PricingUnit[]
  disabled?: boolean
  /** Compact variant for the narrow side panels. */
  compact?: boolean
  /** Let the quantity fall to 0 instead of stopping at 1 — the cart uses this so
   *  stepping (or typing) below one still means "take it out", which is how the
   *  cart's − has always behaved. Elsewhere 1 is the floor. */
  allowZero?: boolean
  /** Describes the thing being counted, for screen readers. */
  label: string
  onQuantityChange: (quantity: number) => void
  onUnitChange?: (unit: PricingUnit) => void
}

/**
 * Quantity + pricing-unit control. The unit is always visible — a "1" against a
 * loose-produce item means one *kilogram*, and that has to be readable at a
 * glance rather than inferred from the price line. The number is typeable as
 * well as steppable, because kilograms are routinely not whole (0.5 kg of
 * mushrooms) and clicking + from 1 to 3 is worse than typing 3.
 */
export function QuantityPicker({
  quantity,
  unit,
  units,
  disabled,
  compact,
  allowZero,
  label,
  onQuantityChange,
  onUnitChange
}: Props): JSX.Element {
  // While the field has focus the user owns its text: a bare "0." or an empty
  // box has to survive keystrokes, so the parsed value is only pushed up on
  // commit (blur / Enter), and the draft is dropped afterwards.
  const [draft, setDraft] = useState<string | null>(null)

  function commit(raw: string): void {
    setDraft(null)
    const n = Number.parseFloat(raw)
    // Unparseable input reverts to the last good value rather than guessing.
    if (!Number.isFinite(n)) return
    const next = n <= 0 && allowZero ? 0 : clampQty(n, unit)
    if (next !== quantity) onQuantityChange(next)
  }

  function step(dir: 1 | -1): void {
    const next = stepQty(quantity, unit, dir)
    if (dir === -1 && allowZero) {
      onQuantityChange(Math.max(0, next))
      return
    }
    // The steppers work in whole units even for weight — fractions of a kilo are
    // reached by typing, so − from 1 kg doesn't drop to a token 0.1 kg.
    onQuantityChange(Math.max(1, clampQty(next, unit)))
  }

  const canDecrease = allowZero ? quantity > 0 : quantity > 1

  return (
    <div className={`qty-picker${compact ? ' compact' : ''}`}>
      <div className="qty-stepper">
        <button
          title="Decrease quantity"
          aria-label={`Decrease quantity of ${label}`}
          disabled={disabled || !canDecrease}
          onClick={() => step(-1)}
        >
          −
        </button>
        <input
          className="qty-input"
          type="text"
          inputMode="decimal"
          value={draft ?? formatQty(quantity, unit)}
          disabled={disabled}
          aria-label={`Quantity of ${label} in ${unit === 'Kg' ? 'kilograms' : 'items'}`}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setDraft(null)
          }}
        />
        <button
          title="Increase quantity"
          aria-label={`Increase quantity of ${label}`}
          disabled={disabled}
          onClick={() => step(1)}
        >
          +
        </button>
      </div>
      {units.length > 1 && onUnitChange ? (
        <div className="unit-toggle" role="group" aria-label={`Pricing unit for ${label}`}>
          {units.map((u) => (
            <button
              key={u}
              className={u === unit ? 'on' : ''}
              disabled={disabled}
              aria-pressed={u === unit}
              title={u === 'Kg' ? 'Buy by weight (per kg)' : 'Buy per item'}
              onClick={() => {
                if (u === unit) return
                onUnitChange(u)
                // The old quantity may be illegal in the new unit (0.5 pieces),
                // so re-snap it as part of the switch.
                onQuantityChange(clampQty(quantity, u))
              }}
            >
              {unitLabel(u)}
            </button>
          ))}
        </div>
      ) : (
        <span className="unit-static">{unitLabel(unit)}</span>
      )}
    </div>
  )
}
