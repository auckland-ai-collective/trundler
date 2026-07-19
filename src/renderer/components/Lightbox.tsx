import { useEffect } from 'react'

interface Props {
  src: string
  alt?: string
  /** Optional caption shown under the image (e.g. the product name). */
  caption?: string
  onClose: () => void
}

/** Full-size image overlay. Closes on backdrop click, the × button, or Esc. */
export function Lightbox({ src, alt, caption, onClose }: Props): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="lightbox-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <button className="lightbox-close" title="Close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      <div className="lightbox-body" onClick={(e) => e.stopPropagation()}>
        <img className="lightbox-img" src={src} alt={alt ?? ''} />
        {caption ? <div className="lightbox-caption">{caption}</div> : null}
      </div>
    </div>
  )
}
