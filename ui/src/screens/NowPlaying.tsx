import { Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Cover } from '../components/Cover'
import { Record } from '../components/Record'
import { FormatBadges, SignalPath } from '../components/ui'
import { type Status, backdropUrl, coverUrl, fmtTime } from '../lib/api'
import { setAccentFrom } from '../lib/color'
import { useRemote } from '../lib/keys'
import { sfx } from '../lib/sounds'

type Transport = 'playpause' | 'next' | 'prev' | 'volup' | 'voldown'

/** The record slides out of its sleeve and spins while it plays. */
export function NowPlaying({
  status, outputName, bitPerfect, onBack, onTransport,
}: {
  status: Status | null
  outputName: string
  bitPerfect: boolean
  onBack: () => void
  onTransport: (k: Transport) => void
}) {
  const song = status?.song
  const [flash, setFlash] = useState<Transport | null>(null)
  useEffect(() => {
    if (song) setAccentFrom(coverUrl(song.file, 0.05))
  }, [song?.file])

  const press = (k: Transport) => {
    onTransport(k)
    setFlash(k)
    setTimeout(() => setFlash(null), 220)
  }
  useRemote((k) => {
    if (k === 'back' || k === 'menu') {
      sfx.back()
      onBack()
    } else if (k === 'ok' || k === 'playpause') press('playpause')
    else if (k === 'right' || k === 'next') press('next')
    else if (k === 'left' || k === 'prev') press('prev')
    else if (k === 'up' || k === 'volup') press('volup')
    else if (k === 'down' || k === 'voldown') press('voldown')
    else return false
    return true
  })

  if (!song) {
    return <div className="tv flex h-full items-center justify-center text-white/50">Nothing playing</div>
  }
  const playing = status.state === 'play'
  const pct = status.duration ? (100 * status.elapsed) / status.duration : 0
  const size = 'min(62vh, 34vw)'
  const ctl = (k: Transport, active?: boolean) =>
    `flex items-center justify-center rounded-full transition-[transform,background-color,color] duration-200 ${
      flash === k ? 'scale-90 bg-white text-[rgb(12_12_14)]' : active ? 'bg-white text-[rgb(12_12_14)]' : 'bg-white/[0.08] text-white/80'
    }`

  return (
    <div className="tv relative h-full overflow-hidden">
      <img key={song.file} src={backdropUrl(song.file)} alt="" className="mo-backdrop mo-fade-in opacity-70" />
      <div className="absolute inset-0 bg-[rgb(9_9_11/0.6)]" />

      <div className="relative flex h-full items-center gap-[4vw] px-[7vw]">
        <div className={`relative shrink-0 ${playing ? '' : 'mo-paused'}`} style={{ width: size, height: size }}>
          <div
            className="absolute top-[3%] left-0 h-[94%] w-[94%] transition-transform duration-[1400ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]"
            style={{ transform: playing ? 'translateX(36%)' : 'translateX(6%)' }}
          >
            <Record size="100%" accent />
          </div>
          <Cover
            key={song.file}
            file={song.file}
            title={song.album}
            artist={song.artist}
            fraction={0.36}
            eager
            className="relative aspect-square w-full rounded-[0.6rem] shadow-[0_2.5rem_5rem_-1rem_rgb(0_0_0/0.85)]"
          />
        </div>

        <div className="min-w-0 flex-1 pl-[8vw]">
          <FormatBadges codec={song.codec} format={song.format} />
          <h1 key={song.title} className="mo-fade-in mt-5 line-clamp-2 text-[2.9rem] leading-[1.05] font-semibold tracking-[-0.025em]">
            {song.title}
          </h1>
          <div className="mt-3 text-[1.3rem] text-white/80">{song.artist}</div>
          <div className="mt-1 text-[1rem] text-white/45">{song.album}</div>

          <div className="mt-10 max-w-[34rem]">
            <div className="h-[5px] overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-white/85 transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2.5 flex justify-between text-[0.85rem] tabular-nums text-white/50">
              <span>{fmtTime(status.elapsed)}</span>
              <span>-{fmtTime(status.duration - status.elapsed)}</span>
            </div>
          </div>

          <div className="mt-8 flex items-center gap-4">
            <span className={`${ctl('prev')} size-[3.4rem]`}>
              <SkipBack className="size-[1.35rem] fill-current" />
            </span>
            <span className={`${ctl('playpause', true)} size-[4.4rem]`}>
              {playing ? <Pause className="size-[1.7rem] fill-current" /> : <Play className="ml-1 size-[1.7rem] fill-current" />}
            </span>
            <span className={`${ctl('next')} size-[3.4rem]`}>
              <SkipForward className="size-[1.35rem] fill-current" />
            </span>
            {status.volume >= 0 && (
              <span className="ml-6 inline-flex items-center gap-3 text-white/55">
                <Volume2 className="size-[1.2rem]" strokeWidth={1.75} />
                <span className="h-[4px] w-[7rem] overflow-hidden rounded-full bg-white/15">
                  <span className="block h-full bg-white/70" style={{ width: `${status.volume}%` }} />
                </span>
              </span>
            )}
          </div>

          <div className="mt-12">
            <SignalPath status={status} outputName={outputName} bitPerfect={bitPerfect} />
          </div>
        </div>
      </div>
    </div>
  )
}
