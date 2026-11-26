import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * An image that changes without ever going blank: the new picture is decoded first, then
 * fades in over the old one, and the old one is dropped once covered. With `group` (e.g. the
 * album folder) a new src in the same group is ignored: every track of an album shares its
 * cover, so changing tracks doesn't touch it at all.
 */
export function FadeImage({
  src, group, className = '', imgClassName = '', fallback = null,
}: { src?: string; group?: string; className?: string; imgClassName?: string; fallback?: ReactNode }) {
  const [layers, setLayers] = useState<{ src: string; id: number }[]>([])
  const [failed, setFailed] = useState(false)
  const cur = useRef<{ group?: string; src?: string }>({})

  useEffect(() => {
    if (!src) return
    if ((group && cur.current.group === group) || cur.current.src === src) return
    cur.current = { group, src }
    let cancelled = false
    let done = false
    const img = new Image()
    img.decoding = 'async'
    img.src = src
    img.decode().then(
      () => {
        done = true
        if (cancelled) return
        setFailed(false)
        setLayers((l) => [...l.slice(-1), { src, id: performance.now() }])
      },
      () => {
        done = true
        if (cancelled) return
        setFailed(true)
        setLayers([])
      },
    )
    return () => {
      cancelled = true
      // superseded before it finished: forget it so the next src is loaded
      if (!done && cur.current.src === src) cur.current = {}
    }
  }, [src, group])

  // once the newest layer has faded in, drop the ones under it
  const newest = layers[layers.length - 1]?.id
  useEffect(() => {
    if (layers.length < 2) return
    const t = setTimeout(() => setLayers((l) => l.slice(-1)), 650)
    return () => clearTimeout(t)
  }, [newest, layers.length])

  return (
    <div className={className}>
      {failed && fallback}
      {layers.map((l, i) => (
        <img key={l.id} src={l.src} alt="" draggable={false}
          className={`${imgClassName} ${i === layers.length - 1 ? 'mo-layer-in' : ''}`} />
      ))}
    </div>
  )
}

/**
 * Text that changes with a short crossfade instead of blinking out and back: the previous
 * content stays on top of the new one while it fades. `k` says when it's "new" content.
 */
export function Crossfade({ k, children, className = '' }: { k: string; children: ReactNode; className?: string }) {
  const [prev, setPrev] = useState<{ node: ReactNode; id: number } | null>(null)
  const [gen, setGen] = useState(0)
  const last = useRef<{ k: string; node: ReactNode }>({ k, node: children })

  useLayoutEffect(() => {
    if (last.current.k !== k) {
      setPrev({ node: last.current.node, id: performance.now() })
      setGen((g) => g + 1)
    }
    last.current = { k, node: children }
  })
  useEffect(() => {
    if (!prev) return
    const t = setTimeout(() => setPrev(null), 280)
    return () => clearTimeout(t)
  }, [prev])

  return (
    <div className={`grid ${className}`}>
      {prev && (
        <div key={`p${prev.id}`} aria-hidden className="mo-text-out pointer-events-none min-w-0 [grid-area:1/1]">
          {prev.node}
        </div>
      )}
      <div key={`c${gen}`} className={`min-w-0 [grid-area:1/1] ${gen ? 'mo-text-in' : ''}`}>
        {children}
      </div>
    </div>
  )
}
