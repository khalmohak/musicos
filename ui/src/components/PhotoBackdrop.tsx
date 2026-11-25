import { backdrop } from '../lib/backgrounds'

/** Full-screen photograph behind a screen: slow drift, darkened so text and focus stay clear. */
export function PhotoBackdrop({ index, dim = 0.72, drift = true }: { index: number; dim?: number; drift?: boolean }) {
  const b = backdrop(index)
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      <img
        key={b.src}
        src={b.src}
        alt=""
        className={`mo-photo absolute inset-0 size-full object-cover ${drift ? 'mo-kenburns' : ''}`}
        style={{ objectPosition: b.focus }}
      />
      <div className="absolute inset-0" style={{ background: `rgb(9 9 11 / ${dim})` }} />
      <div className="absolute inset-0 bg-gradient-to-t from-[rgb(9_9_11)] via-transparent to-[rgb(9_9_11/0.5)]" />
    </div>
  )
}
