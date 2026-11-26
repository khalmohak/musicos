import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * A grid for a TV: only the rows near the view exist, and moving between rows slides the whole
 * grid as one GPU layer (CSS transform, run by the compositor) instead of animating scrollTop,
 * which repaints the scroll area every frame. The focused row is kept centred.
 *
 * Sizes are given in viewport units so it lays out like the rest of the UI at any resolution.
 */
export function VirtualWall({
  count, cols, idx, keyOf, renderItem, colGapVw, rowGapVh, padXVw, padTopVh, padBottomVh, extraRem = 0, onWheelRows,
  focused = true, round = false,
}: {
  count: number
  cols: number
  idx: number
  keyOf: (i: number) => string
  renderItem: (i: number) => ReactNode
  colGapVw: number
  rowGapVh: number
  padXVw: number
  padTopVh: number
  padBottomVh: number
  /** extra height under each square tile (e.g. a name), in rem */
  extraRem?: number
  onWheelRows?: (rows: number) => void
  /** show the focus shadow (false while focus is in the header) */
  focused?: boolean
  /** circular tiles (artists) */
  round?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0, vw: 0, vh: 0, rem: 16 })
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setSize({
      w: el.clientWidth, h: el.clientHeight, vw: window.innerWidth / 100, vh: window.innerHeight / 100,
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
    })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const colGap = colGapVw * size.vw
  const rowGap = rowGapVh * size.vh
  const padX = padXVw * size.vw
  const padTop = padTopVh * size.vh
  const padBottom = padBottomVh * size.vh
  const tileW = Math.max(1, (size.w - 2 * padX - (cols - 1) * colGap) / cols)
  const tileH = tileW + extraRem * size.rem
  const rowH = tileH + rowGap
  const rows = Math.ceil(count / cols)
  const contentH = padTop + rows * rowH - rowGap + padBottom
  const focusRow = Math.floor(idx / cols)
  const offset = Math.round(Math.max(0, Math.min(Math.max(0, contentH - size.h), padTop + focusRow * rowH - (size.h - tileW) / 2)))

  // while sliding, keep the rows between the old and new position rendered
  const [settled, setSettled] = useState(offset)
  useEffect(() => {
    const t = setTimeout(() => setSettled(offset), 480)
    return () => clearTimeout(t)
  }, [offset])
  const lo = Math.min(offset, settled)
  const hi = Math.max(offset, settled) + size.h
  const first = Math.max(0, Math.floor((lo - padTop) / rowH) - 1)
  const last = Math.min(rows - 1, Math.ceil((hi - padTop) / rowH) + 1)

  // wheel / touchpad: whole rows at a time
  const wheel = useRef(0)
  const onWheel = (e: React.WheelEvent) => {
    if (!onWheelRows) return
    wheel.current += e.deltaY
    if (Math.abs(wheel.current) > 60) {
      onWheelRows(Math.sign(wheel.current))
      wheel.current = 0
    }
  }

  const items: ReactNode[] = []
  if (size.w > 0) {
    for (let r = first; r <= last; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        if (i >= count) break
        items.push(
          <div key={keyOf(i)} className="absolute" style={{ left: padX + c * (tileW + colGap), top: padTop + r * rowH, width: tileW, height: tileH }}>
            {renderItem(i)}
          </div>,
        )
      }
    }
  }
  return (
    <div ref={box} onWheel={onWheel} className="relative h-full overflow-hidden">
      <div
        className="relative will-change-transform"
        style={{ height: contentH, transform: `translate3d(0, ${-offset}px, 0)`, transition: 'transform 460ms cubic-bezier(0.22, 0.8, 0.2, 1)' }}
      >
        {/* one shared focus shadow that glides to the focused tile: a blurred shadow per tile,
            faded in and out on every move, was expensive to paint */}
        {size.w > 0 && count > 0 && (
          <div
            aria-hidden
            className={`pointer-events-none absolute top-0 left-0 will-change-transform ${round ? 'rounded-full' : 'rounded-[0.75rem]'}`}
            style={{
              width: tileW, height: tileW,
              boxShadow: '0 1.8rem 3.2rem -1rem rgb(0 0 0 / 0.85)',
              opacity: focused ? 1 : 0,
              transform: `translate3d(${padX + (idx % cols) * (tileW + colGap)}px, ${padTop + focusRow * rowH}px, 0) scale(1.08)`,
              transition: 'transform 320ms cubic-bezier(0.22, 0.8, 0.2, 1), opacity 200ms ease',
            }}
          />
        )}
        {items}
      </div>
    </div>
  )
}
