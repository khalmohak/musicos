import { Button } from '@glyphui/ui'
import { Settings as SettingsIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Cover } from '../components/Cover'
import { NowPlayingBar } from '../components/NowPlayingBar'
import { Record } from '../components/Record'
import { FormatBadges } from '../components/ui'
import { type Album, type Status, albumKey, coverUrl } from '../lib/api'
import { setAccentFrom } from '../lib/color'
import { useRemote } from '../lib/keys'
import { sfx } from '../lib/sounds'

const COLS = 7

function greeting(name: string) {
  const h = new Date().getHours()
  const part = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Late night'
  const first = name.trim().split(' ')[0]
  return first ? `${part}, ${first}` : part
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(t)
  }, [])
  return now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

type Transport = 'playpause' | 'next' | 'prev' | 'volup' | 'voldown'

export function Home({
  albums, status, name, focusKey, onOpen, onNowPlaying, onSettings, onTransport,
}: {
  albums: Album[]
  status: Status | null
  name: string
  focusKey: string | null
  onOpen: (a: Album) => void
  onNowPlaying: () => void
  onSettings: () => void
  onTransport: (k: Transport) => void
}) {
  const initial = useMemo(() => Math.max(0, albums.findIndex((a) => albumKey(a) === focusKey)), [albums, focusKey])
  const [idx, setIdx] = useState(initial)
  const [zone, setZone] = useState<'header' | 'wall' | 'bar'>('wall')
  const tiles = useRef<(HTMLButtonElement | null)[]>([])
  const clock = useClock()
  const playing = !!status?.song
  const current = albums[idx]

  useLayoutEffect(() => {
    if (zone !== 'wall') return
    tiles.current[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [idx, zone])

  useEffect(() => {
    if (current) setAccentFrom(coverUrl(current.file, 96))
  }, [current])

  useRemote((k) => {
    if (k === 'playpause' || k === 'next' || k === 'prev' || k === 'volup' || k === 'voldown') {
      onTransport(k)
      return true
    }
    if (k === 'menu') {
      if (playing) onNowPlaying()
      return true
    }
    if (zone === 'header') {
      if (k === 'down') setZone('wall')
      else if (k === 'ok') return sfx.select(), onSettings(), true
      else return k !== 'back'
      sfx.tick()
      return true
    }
    if (zone === 'bar') {
      if (k === 'up') setZone('wall')
      else if (k === 'ok') return sfx.select(), onNowPlaying(), true
      else return k !== 'back'
      sfx.tick()
      return true
    }
    const n = albums.length
    let next = idx
    if (k === 'left') next = idx % COLS === 0 ? idx : idx - 1
    else if (k === 'right') next = idx % COLS === COLS - 1 || idx === n - 1 ? idx : idx + 1
    else if (k === 'up') {
      if (idx < COLS) return setZone('header'), sfx.tick(), true
      next = idx - COLS
    } else if (k === 'down') {
      const lastRow = Math.floor((n - 1) / COLS)
      if (Math.floor(idx / COLS) === lastRow) {
        if (playing) return setZone('bar'), sfx.tick(), true
      } else next = Math.min(n - 1, idx + COLS)
    } else if (k === 'ok') {
      sfx.select()
      if (current) onOpen(current)
      return true
    } else return false
    if (next === idx) sfx.edge()
    else {
      sfx.tick()
      setIdx(next)
    }
    return true
  })

  if (!albums.length) {
    return (
      <div className="tv flex h-full flex-col items-center justify-center gap-5 text-center">
        <Record size="9rem" spinning={false} />
        <h1 className="mt-4 text-[2.2rem] font-semibold tracking-[-0.02em]">No albums yet</h1>
        <p className="max-w-[32rem] text-white/55">Plug in a drive, add a network share, or copy music in. Then scan the library.</p>
        <Button data-nav autoFocus onClick={onSettings}>
          <SettingsIcon />
          Open settings
        </Button>
      </div>
    )
  }

  return (
    <div className="tv relative flex h-full flex-col">
      <div className="mo-ambient" />

      <header className="relative z-10 flex items-start justify-between px-[4.5vw] pt-[5vh]">
        <div key={current ? albumKey(current) : ''} className="mo-fade-in min-w-0 pr-8">
          <div className="eyebrow">{greeting(name)}</div>
          <h1 className="mt-3 truncate text-[2.4rem] leading-tight font-semibold tracking-[-0.025em]">{current?.album}</h1>
          <div className="mt-1.5 flex items-center gap-3 text-[1.02rem] text-white/60">
            <span className="truncate">
              {current?.artist}
              {current?.year && ` · ${current.year}`}
            </span>
            {current && <FormatBadges codec={current.codec} format={current.format} />}
          </div>
        </div>
        <div className="flex items-center gap-6 pt-1">
          <span className="text-[1.15rem] font-medium tabular-nums text-white/75">{clock}</span>
          <span
            className={`flex size-[2.9rem] items-center justify-center rounded-full transition-[transform,background-color,color] duration-200 ${
              zone === 'header' ? 'scale-110 bg-white text-[rgb(12_12_14)]' : 'bg-white/[0.08] text-white/70'
            }`}
          >
            <SettingsIcon className="size-[1.3rem]" strokeWidth={1.75} />
          </span>
        </div>
      </header>

      <div className="no-scrollbar relative flex-1 overflow-y-auto px-[4.5vw] pt-[4vh] pb-[18vh]">
        <div className="grid gap-x-[1.7vw] gap-y-[3.2vh]" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
          {albums.map((a, i) => (
            <button
              key={albumKey(a)}
              ref={(el) => {
                tiles.current[i] = el
              }}
              type="button"
              tabIndex={-1}
              onClick={() => onOpen(a)}
              className={`lift relative aspect-square rounded-[0.75rem] ${zone === 'wall' && i === idx ? 'is-focused' : ''}`}
            >
              <Cover
                file={a.file}
                title={a.album}
                artist={a.artist}
                size={360}
                eager={i < COLS * 3}
                className="size-full rounded-[0.75rem] text-[0.95rem]"
              />
            </button>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[24vh] bg-gradient-to-t from-[rgb(9_9_11)] via-[rgb(9_9_11/0.8)] to-transparent" />
      <div className="absolute right-[4.5vw] bottom-[4.5vh] z-10">
        <NowPlayingBar status={status} focused={zone === 'bar'} />
      </div>
    </div>
  )
}
