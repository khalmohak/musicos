// Eased, interruptible scrolling for remote navigation. Native smooth scrolling on embedded
// WebKit can stutter and queues up when you hold an arrow; this always heads for the latest
// target from wherever the scroll currently is.
const running = new WeakMap<HTMLElement, number>()
const ease = (t: number) => 1 - (1 - t) ** 3 // easeOutCubic

export function scrollToSmooth(el: HTMLElement, top: number, left: number | null = null, ms = 360) {
  const prev = running.get(el)
  if (prev) cancelAnimationFrame(prev)
  const maxTop = el.scrollHeight - el.clientHeight
  const maxLeft = el.scrollWidth - el.clientWidth
  const toTop = Math.max(0, Math.min(maxTop, top))
  const toLeft = left === null ? el.scrollLeft : Math.max(0, Math.min(maxLeft, left))
  const fromTop = el.scrollTop
  const fromLeft = el.scrollLeft
  if (Math.abs(toTop - fromTop) < 1 && Math.abs(toLeft - fromLeft) < 1) return
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    const k = ease(t)
    el.scrollTop = fromTop + (toTop - fromTop) * k
    el.scrollLeft = fromLeft + (toLeft - fromLeft) * k
    if (t < 1) running.set(el, requestAnimationFrame(step))
    else running.delete(el)
  }
  running.set(el, requestAnimationFrame(step))
}

/** Keep `item` comfortably in view inside its scroll container: centred vertically
 *  (block) and/or horizontally (inline). */
export function reveal(item: HTMLElement | null | undefined, opts: { block?: 'center' | 'nearest'; inline?: 'center' | 'nearest' } = {}) {
  if (!item) return
  let c: HTMLElement | null = item.parentElement
  while (c && !(c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1)) c = c.parentElement
  if (!c) return
  const cr = c.getBoundingClientRect()
  const ir = item.getBoundingClientRect()
  let top = c.scrollTop
  let left: number | null = null
  if (opts.block) {
    const y = ir.top - cr.top + c.scrollTop
    if (opts.block === 'center') top = y - (c.clientHeight - ir.height) / 2
    else if (ir.top < cr.top + 40) top = y - 40
    else if (ir.bottom > cr.bottom - 40) top = y + ir.height - c.clientHeight + 40
  }
  if (opts.inline) {
    const x = ir.left - cr.left + c.scrollLeft
    left = opts.inline === 'center' ? x - (c.clientWidth - ir.width) / 2 : ir.left < cr.left + 40 ? x - 40 : ir.right > cr.right - 40 ? x + ir.width - c.clientWidth + 40 : c.scrollLeft
  }
  scrollToSmooth(c, top, left)
}
