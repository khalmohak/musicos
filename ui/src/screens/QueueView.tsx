import { Button } from '@glyphui/ui'
import { AudioLines, ListMusic, Shuffle, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type QueueItem, type Status, api, coverUrl, fmtTime } from '../lib/api'
import { moveSpatial, useRemote } from '../lib/keys'
import { reveal } from '../lib/motion'
import { sfx } from '../lib/sounds'

/** Up Next: the play queue. OK jumps to a song. */
export function QueueView({ status, onBack, onPlayed }: { status: Status | null; onBack: () => void; onPlayed: (s: Status) => void }) {
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const focused = useRef(false)

  useEffect(() => {
    api.queue().then(setItems).catch(() => setItems([]))
  }, [status?.pos, status?.queueLength])

  // first render: focus the current song
  useLayoutEffect(() => {
    if (!items || focused.current) return
    focused.current = true
    const el = ref.current?.querySelector<HTMLElement>('[data-current="1"]') ?? ref.current?.querySelector<HTMLElement>('[data-nav]')
    el?.focus()
    reveal(el, { block: 'center' })
  }, [items])

  useRemote((k) => {
    if (k === 'back') return sfx.back(), onBack(), true
    if (k === 'up' || k === 'down' || k === 'left' || k === 'right') return moveSpatial(ref.current, k) ? (sfx.tick(), true) : (sfx.edge(), true)
    return false
  })

  const rest = items?.filter((i) => i.pos > (status?.pos ?? -1)) ?? []
  const left = rest.reduce((s, i) => s + i.duration, 0)

  return (
    <div className="tv relative flex h-full">
      <div className="mo-ambient" />
      <aside className="relative flex w-[30vw] shrink-0 flex-col justify-center px-[5vw]">
        <div className="mb-7 flex size-[4.6rem] items-center justify-center rounded-[1.3rem] bg-white/[0.07]">
          <ListMusic className="size-[2.1rem] text-white/85" strokeWidth={1.5} />
        </div>
        <h1 className="text-[2.5rem] font-semibold tracking-[-0.025em]">Up Next</h1>
        <p className="mt-3 text-[1.02rem] text-white/55">
          {items === null ? '…' : rest.length === 0 ? 'Nothing after this song.' : `${rest.length} songs · ${Math.round(left / 60)} min`}
        </p>
      </aside>
      <div ref={ref} className="no-scrollbar relative flex-1 overflow-y-auto py-[10vh] pr-[6vw] pl-2">
        <div className="mb-6 flex gap-3">
          <Button data-nav onClick={async () => (sfx.select(), onPlayed(await api.shuffle()))}>
            <Shuffle />
            Shuffle library
          </Button>
          {!!items?.length && (
            <Button data-nav onClick={async () => (sfx.select(), await api.clearQueue(), setItems([]))}>
              <Trash2 />
              Clear
            </Button>
          )}
        </div>
        {items?.map((it) => (
          <button
            key={`${it.pos}-${it.file}`}
            type="button"
            data-nav
            data-current={it.current ? '1' : undefined}
            onClick={async () => (sfx.select(), onPlayed(await api.playPos(it.pos)))}
            className={`flex w-full items-center gap-4 rounded-[0.9rem] px-3 py-2.5 text-left transition-[transform,background-color,color] duration-200 focus:scale-[1.02] focus:bg-white focus:text-[rgb(12_12_14)] ${
              it.pos < (status?.pos ?? -1) ? 'opacity-45' : ''
            }`}
          >
            <img src={coverUrl(it.file, 0.04)} alt="" loading="lazy" className="size-[3rem] rounded-[0.5rem] object-cover" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[1rem] font-medium">{it.title}</span>
              <span className="block truncate text-[0.82rem] opacity-55">
                {it.artist} · {it.album}
              </span>
            </span>
            {it.current ? <AudioLines className="size-[1.1rem]" /> : <span className="text-[0.85rem] tabular-nums opacity-45">{it.duration ? fmtTime(it.duration) : ''}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
