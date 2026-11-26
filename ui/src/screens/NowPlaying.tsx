import { BookOpen, ListMusic, MicVocal, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Cover } from '../components/Cover'
import { ReceiverNowPlaying } from '../components/ReceiverNowPlaying'
import { Record } from '../components/Record'
import { FormatBadges } from '../components/ui'
import { type Lyrics, type Status, api, backdropUrl, coverUrl, fmtTime } from '../lib/api'
import { setAccentFrom } from '../lib/color'
import { Crossfade, FadeImage } from '../components/Fade'
import { cardLines, useTrackCard } from '../lib/info'
import { useRemote } from '../lib/keys'
import { sfx } from '../lib/sounds'

type Transport = 'playpause' | 'next' | 'prev' | 'volup' | 'voldown'
const CONTROLS = ['prev', 'playpause', 'next', 'lyrics', 'about', 'queue'] as const
type Control = (typeof CONTROLS)[number]

/** Smooth playback position between 1 s status polls. */
function useLiveElapsed(status: Status | null) {
  const [now, setNow] = useState(0)
  const base = useRef({ elapsed: 0, at: 0 })
  useEffect(() => {
    base.current = { elapsed: status?.elapsed ?? 0, at: performance.now() }
  }, [status?.elapsed, status?.song?.file])
  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (t: number) => {
      if (t - last > 100) {
        last = t
        const b = base.current
        setNow(status?.state === 'play' ? b.elapsed + (performance.now() - b.at) / 1000 : b.elapsed)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [status?.state])
  return now
}

/**
 * Scrubbing: hold or repeat left/right on the progress bar. Steps grow the longer you go
 * (5 s -> 10 s -> 20 s -> 30 s); the seek is sent once you pause, so it feels instant.
 */
function useScrub(duration: number, elapsed: number, file: string | undefined) {
  const [target, setTarget] = useState<number | null>(null)
  const streak = useRef({ dir: 0, n: 0, at: 0 })
  const commit = useRef<number>(0)
  useEffect(() => setTarget(null), [file])
  // once the player has caught up with the target, stop showing the preview
  useEffect(() => {
    if (target !== null && Math.abs(elapsed - target) < 1.5 && !commit.current) setTarget(null)
  }, [elapsed, target])

  const nudge = (dir: 1 | -1) => {
    const now = performance.now()
    const s = streak.current
    s.n = s.dir === dir && now - s.at < 450 ? s.n + 1 : 0
    s.dir = dir
    s.at = now
    const step = s.n < 3 ? 5 : s.n < 8 ? 10 : s.n < 16 ? 20 : 30
    const from = target ?? elapsed
    const to = Math.max(0, Math.min(Math.max(0, duration - 1), from + dir * step))
    setTarget(to)
    sfx.tick()
    window.clearTimeout(commit.current)
    commit.current = window.setTimeout(() => {
      commit.current = 0
      api.seek(to).catch(() => setTarget(null))
    }, 420)
  }
  return { target, nudge }
}

/** The record slides out of its sleeve and spins while it plays. Lyrics replace the details. */
export function NowPlaying({
  status, onBack, onTransport, onQueue, onAbout, showFacts = true,
}: {
  status: Status | null
  outputName?: string
  bitPerfect?: boolean
  onBack: () => void
  onTransport: (k: Transport) => void
  onQueue: () => void
  /** the album's story screen */
  onAbout?: () => void
  /** the facts line under the title (Settings) */
  showFacts?: boolean
}) {
  const song = status?.song
  const card = useTrackCard(song?.artist, song?.album, song?.title)
  /** the album folder: cover, backdrop and accent only change when this does */
  const albumDir = song ? song.file.slice(0, song.file.lastIndexOf('/')) : ''
  const [zone, setZone] = useState<'scrub' | 'controls'>('controls')
  const [focus, setFocus] = useState(1)
  const [pressed, setPressed] = useState<string | null>(null)
  const [lyrics, setLyrics] = useState<Lyrics | null>(null)
  const [showLyrics, setShowLyrics] = useState(() => new URLSearchParams(location.search).has('lyrics') || localStorage.getItem('mo-lyrics') === '1')
  const elapsed = useLiveElapsed(status)
  const duration = status?.duration ?? 0
  const { target, nudge } = useScrub(duration, elapsed, song?.file)
  const shown = target ?? elapsed

  useEffect(() => {
    if (song) setAccentFrom(coverUrl(song.file, 0.05))
  }, [albumDir])
  useEffect(() => {
    if (!song) return
    setLyrics(null)
    api.lyrics(song.file).then((l) => setLyrics(l.lines.length ? l : null)).catch(() => {})
  }, [song?.file])

  const flash = (k: string) => {
    setPressed(k)
    setTimeout(() => setPressed(null), 180)
  }
  const toggleLyrics = () =>
    setShowLyrics((v) => {
      try {
        localStorage.setItem('mo-lyrics', v ? '0' : '1')
      } catch {}
      return !v
    })
  const activate = (c: Control) => {
    flash(c)
    if (c === 'lyrics') return lyrics ? (sfx.select(), toggleLyrics()) : sfx.edge()
    if (c === 'queue') return sfx.select(), onQueue()
    if (c === 'about') return onAbout ? (sfx.select(), onAbout()) : sfx.edge()
    onTransport(c)
  }

  useRemote((k) => {
    if (k === 'back') return sfx.back(), onBack(), true
    if (k === 'menu') return activate('lyrics'), true
    if (k === 'playpause' || k === 'next' || k === 'prev' || k === 'volup' || k === 'voldown') {
      flash(k)
      onTransport(k)
      return true
    }
    if (zone === 'scrub') {
      if (k === 'left' || k === 'right') return nudge(k === 'right' ? 1 : -1), true
      if (k === 'down') return setZone('controls'), sfx.tick(), true
      if (k === 'ok') return flash('playpause'), onTransport('playpause'), true
      if (k === 'up') return sfx.edge(), true
      return false
    }
    if (k === 'left' || k === 'right') {
      const n = Math.max(0, Math.min(CONTROLS.length - 1, focus + (k === 'right' ? 1 : -1)))
      n === focus ? sfx.edge() : sfx.tick()
      setFocus(n)
      return true
    }
    if (k === 'up') return setZone('scrub'), sfx.tick(), true
    if (k === 'down') return sfx.edge(), true
    if (k === 'ok') return activate(CONTROLS[focus]), true
    return false
  })

  if (status?.receiver) return <ReceiverNowPlaying r={status.receiver} />
  if (!song) return <div className="tv flex h-full items-center justify-center text-white/50">Nothing playing</div>

  const playing = status.state === 'play'
  const pct = duration ? (100 * Math.min(shown, duration)) / duration : 0
  const size = 'min(62vh, 34vw)'
  const lyricsOn = showLyrics && !!lyrics
  const scrubbing = zone === 'scrub'

  const btn = (c: Control, big = false) => {
    const focused = zone === 'controls' && CONTROLS[focus] === c
    const Icon = c === 'prev' ? SkipBack : c === 'next' ? SkipForward : c === 'lyrics' ? MicVocal : c === 'about' ? BookOpen : c === 'queue' ? ListMusic : playing ? Pause : Play
    const solid = c === 'playpause' || c === 'prev' || c === 'next'
    return (
      <span
        key={c}
        onClick={() => activate(c)}
        onMouseEnter={() => (setZone('controls'), setFocus(CONTROLS.indexOf(c)))}
        className={`flex cursor-pointer items-center justify-center rounded-full transition-[transform,background-color,color,opacity] duration-300 ease-[var(--mo-spring)] ${big ? 'size-[4.4rem]' : 'size-[3.3rem]'} ${
          focused ? 'scale-110 bg-white text-[rgb(12_12_14)]' : c === 'lyrics' && lyricsOn ? 'bg-white/25 text-white' : 'bg-white/[0.08] text-white/80'
        } ${pressed === c ? 'scale-90' : ''} ${(c === 'lyrics' && !lyrics) || (c === 'about' && card?.status !== 'ready') ? 'opacity-30' : ''}`}
      >
        <Icon
          className={`${big ? 'size-[1.7rem]' : 'size-[1.3rem]'} ${solid ? 'fill-current' : ''} ${c === 'playpause' && !playing ? 'ml-1' : ''}`}
          strokeWidth={solid ? 2 : 1.9}
        />
      </span>
    )
  }

  return (
    <div className="tv relative h-full overflow-hidden">
      {/* keyed by album folder: changing tracks within an album leaves cover and backdrop alone */}
      <FadeImage src={backdropUrl(song.file)} group={albumDir} className="absolute inset-0 overflow-hidden opacity-70" imgClassName="mo-backdrop" />
      <div className="absolute inset-0 bg-[rgb(9_9_11/0.58)]" />

      <div className="relative flex h-full items-center gap-[4vw] px-[7vw]">
        <div className={`relative shrink-0 ${playing ? '' : 'mo-paused'}`} style={{ width: size, height: size }}>
          <div
            className="absolute top-[3%] left-0 h-[94%] w-[94%] transition-transform duration-[1400ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]"
            style={{ transform: playing ? 'translateX(36%)' : 'translateX(6%)' }}
          >
            <Record size="100%" accent />
          </div>
          <FadeImage src={coverUrl(song.file, 0.36)} group={albumDir}
            className="relative aspect-square w-full overflow-hidden rounded-[0.6rem] bg-[rgb(28_28_32)] shadow-[0_2.5rem_5rem_-1rem_rgb(0_0_0/0.85)]"
            imgClassName="absolute inset-0 size-full object-cover"
            fallback={<Cover title={song.album} artist={song.artist} className="absolute inset-0 size-full" />} />
        </div>

        <div className="flex h-[78vh] min-w-0 flex-1 flex-col justify-center pl-[8vw]">
          <Crossfade k={song.file}>
            {lyricsOn ? (
              <>
                <div className="truncate text-[1.05rem] font-semibold">{song.title}</div>
                <div className="truncate text-[0.9rem] text-white/55">{song.artist}</div>
              </>
            ) : (
              <>
                <FormatBadges codec={song.codec} format={song.format} />
                <h1 className="mt-5 line-clamp-2 text-[2.9rem] leading-[1.05] font-semibold tracking-[-0.025em]">{song.title}</h1>
                <div className="mt-3 text-[1.3rem] text-white/80">{song.artist}</div>
                <div className="mt-1 text-[1rem] text-white/45">{song.album}</div>
              </>
            )}
          </Crossfade>
          {lyricsOn && <LyricsPanel lyrics={lyrics} elapsed={elapsed} />}
          {!lyricsOn && showFacts && <FactsLine lines={cardLines(card)} trackKey={song.file} />}

          {/* scrubber: Up to focus, then left/right */}
          <div className={`max-w-[36rem] ${lyricsOn ? 'mt-6' : 'mt-10'}`}>
            <div
              className="relative flex h-[1.4rem] cursor-pointer items-center"
              onMouseEnter={() => setZone('scrub')}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                const to = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration
                api.seek(to).catch(() => {})
              }}
            >
              <div
                className="w-full overflow-hidden rounded-full bg-white/15 transition-[height] duration-300 ease-[var(--mo-spring)]"
                style={{ height: scrubbing ? '0.55rem' : '0.3rem' }}
              >
                <div className={`h-full rounded-full bg-white/90 ${target !== null ? 'transition-[width] duration-150' : ''}`} style={{ width: `${pct}%` }} />
              </div>
              <div
                className="absolute top-1/2 size-[1.15rem] rounded-full bg-white shadow-[0_0.2rem_0.8rem_rgb(0_0_0/0.5)] transition-[opacity,transform] duration-300 ease-[var(--mo-spring)]"
                style={{ left: `calc(${pct}% - 0.575rem)`, opacity: scrubbing ? 1 : 0, transform: `translateY(-50%) scale(${scrubbing ? 1 : 0.4})` }}
              />
              {target !== null && (
                <div
                  className="absolute -top-[2.4rem] rounded-full bg-white px-3 py-1 text-[0.85rem] font-semibold tabular-nums text-[rgb(12_12_14)]"
                  style={{ left: `calc(${pct}% - 1.9rem)` }}
                >
                  {fmtTime(target)}
                </div>
              )}
            </div>
            <div className="mt-2 flex justify-between text-[0.85rem] tabular-nums text-white/50">
              <span>{fmtTime(shown)}</span>
              <span>-{fmtTime(duration - shown)}</span>
            </div>
          </div>

          <div className="mt-7 flex items-center gap-4">
            {btn('prev')}
            {btn('playpause', true)}
            {btn('next')}
            <span className="w-3" />
            {btn('lyrics')}
            {btn('about')}
            {btn('queue')}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Synced lyrics: current line bright and centred, neighbours fading out. */
function LyricsPanel({ lyrics, elapsed }: { lyrics: Lyrics | null; elapsed: number }) {
  const lines = lyrics?.lines ?? []
  const current = useMemo(() => {
    if (!lyrics?.synced) return -1
    let c = -1
    for (let i = 0; i < lines.length; i++) {
      if ((lines[i].t ?? 0) <= elapsed + 0.25) c = i
      else break
    }
    return c
  }, [lines, elapsed, lyrics?.synced])
  const LINE = 3.1
  const offset = lyrics?.synced ? Math.max(0, current) * LINE : 0
  return (
    <div className="relative mt-6 h-[40vh] overflow-hidden [mask-image:linear-gradient(transparent,black_22%,black_78%,transparent)]">
      <div
        className="absolute inset-x-0 transition-transform duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
        style={{ top: `calc(50% - ${LINE / 2}rem)`, transform: `translateY(-${offset}rem)` }}
      >
        {lines.map((l, i) => {
          const d = lyrics?.synced ? Math.abs(i - current) : 2
          return (
            <div
              key={i}
              className="flex items-center truncate text-[1.7rem] leading-tight font-semibold tracking-[-0.015em] transition-[opacity,transform] duration-500"
              style={{ height: `${LINE}rem`, opacity: !l.text ? 0 : d === 0 ? 1 : d === 1 ? 0.42 : 0.2, transform: d === 0 ? 'scale(1)' : 'scale(0.94)', transformOrigin: 'left center' }}
            >
              {l.text || '·'}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** One line at a time under the title, from the playing song's card: what to listen for in this
 * track, then what was going on when it was recorded. Every 20 s, crossfaded; resets per track. */
function FactsLine({ lines, trackKey }: { lines: { label: string; text: string }[]; trackKey: string }) {
  const [i, setI] = useState(0)
  useEffect(() => setI(0), [trackKey])
  useEffect(() => {
    if (lines.length < 2) return
    const t = setInterval(() => setI((n) => (n + 1) % lines.length), 20000)
    return () => clearInterval(t)
  }, [lines.length, trackKey])
  const line = lines[i % Math.max(1, lines.length)]
  if (!line) return <div className="mt-7 h-[4.2rem]" />
  return (
    <div className="mt-7 h-[4.2rem] max-w-[36rem]">
      <Crossfade k={`${trackKey}:${i}`}>
        <div className="border-l-2 border-white/25 pl-4">
          <div className="text-[0.72rem] font-medium tracking-[0.12em] text-white/40 uppercase">{line.label}</div>
          <div className="mt-0.5 line-clamp-2 text-[1rem] leading-snug text-white/75">{line.text}</div>
        </div>
      </Crossfade>
    </div>
  )
}
