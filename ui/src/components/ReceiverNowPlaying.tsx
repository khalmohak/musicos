import { Airplay, Radio, Smartphone } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type Receiver, fmtTime } from '../lib/api'
import { setAccentFrom } from '../lib/color'
import { Crossfade, FadeImage } from './Fade'
import { PhotoBackdrop } from './PhotoBackdrop'
import { Record } from './Record'

export const receiverLabel = (r: Receiver) => (r.source === 'airplay' ? 'AirPlay' : 'Spotify Connect')
export const ReceiverIcon = ({ r, className }: { r: Receiver; className?: string }) =>
  r.source === 'airplay' ? <Airplay className={className} strokeWidth={1.9} /> : <Radio className={className} strokeWidth={1.9} />

/** Position between 1 s polls, so the bar glides instead of ticking. */
function useLivePosition(r: Receiver) {
  const [pos, setPos] = useState(r.position)
  const base = useRef({ p: r.position, at: performance.now() })
  useEffect(() => {
    base.current = { p: r.position, at: performance.now() }
  }, [r.position, r.title])
  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (t: number) => {
      if (t - last > 120) {
        last = t
        const b = base.current
        setPos(r.state === 'play' ? b.p + (performance.now() - b.at) / 1000 : b.p)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [r.state])
  return Math.min(pos, r.duration || pos)
}

/** Full-screen now playing for music streamed from a phone (AirPlay / Spotify Connect). */
export function ReceiverNowPlaying({ r }: { r: Receiver }) {
  const [coverOk, setCoverOk] = useState(true)
  const pos = useLivePosition(r)
  useEffect(() => {
    setCoverOk(true)
    if (r.cover) setAccentFrom(r.cover)
  }, [r.cover])
  const playing = r.state === 'play'
  const pct = r.duration ? (100 * pos) / r.duration : 0
  const size = 'min(62vh, 34vw)'
  const hasCover = !!r.cover && coverOk
  const trackKey = `${r.title}|${r.artist}`

  return (
    <div className="tv relative h-full overflow-hidden">
      {/* backdrop: the cover pre-blurred by the agent (cheap to draw), else a photograph */}
      {hasCover ? (
        <FadeImage src={`${r.cover}${r.cover.includes('?') ? '&' : '?'}blur=1`} className="absolute inset-0 overflow-hidden opacity-70" imgClassName="mo-backdrop" />
      ) : (
        <PhotoBackdrop index={2} dim={0.6} />
      )}
      <div className="absolute inset-0 bg-[rgb(9_9_11/0.58)]" />

      <div className="relative flex h-full items-center gap-[4vw] px-[7vw]">
        <div className={`relative shrink-0 ${playing ? '' : 'mo-paused'}`} style={{ width: size, height: size }}>
          <div
            className="absolute top-[3%] left-0 h-[94%] w-[94%] transition-transform duration-[1400ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]"
            style={{ transform: playing ? 'translateX(36%)' : 'translateX(6%)' }}
          >
            <Record size="100%" accent />
          </div>
          <FadeImage src={hasCover ? r.cover : undefined}
            className="relative aspect-square w-full overflow-hidden rounded-[0.6rem] bg-[rgb(28_28_32)] shadow-[0_2.5rem_5rem_-1rem_rgb(0_0_0/0.85)]"
            imgClassName="absolute inset-0 size-full object-cover"
            fallback={<div className="absolute inset-0 flex items-center justify-center"><ReceiverIcon r={r} className="size-1/4 text-white/30" /></div>} />
          {!hasCover && (
            <div className="absolute inset-0 flex items-center justify-center rounded-[0.6rem] bg-[rgb(28_28_32)]">
              <ReceiverIcon r={r} className="size-1/4 text-white/30" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 pl-[8vw]">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[0.82rem] font-medium">
            <ReceiverIcon r={r} className="size-[1rem]" />
            {receiverLabel(r)}
          </span>
          <Crossfade k={trackKey}>
            <h1 className="mt-5 line-clamp-2 text-[2.9rem] leading-[1.05] font-semibold tracking-[-0.025em]">
              {r.title || (playing ? 'Playing' : 'Connected')}
            </h1>
            {r.artist && <div className="mt-3 text-[1.3rem] text-white/80">{r.artist}</div>}
            {r.album && <div className="mt-1 text-[1rem] text-white/45">{r.album}</div>}
          </Crossfade>

          {r.duration > 0 && (
            <div className="mt-10 max-w-[36rem]">
              <div className="h-[0.3rem] overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-white/90" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-[0.85rem] tabular-nums text-white/50">
                <span>{fmtTime(pos)}</span>
                <span>-{fmtTime(r.duration - pos)}</span>
              </div>
            </div>
          )}

          <div className="mt-10 inline-flex items-center gap-2.5 text-[0.95rem] text-white/55">
            <Smartphone className="size-[1.15rem]" strokeWidth={1.75} />
            {r.device ? `Playing from ${r.device}` : 'Playing from your phone'}
            {!playing && ' · paused'}
          </div>
          <div className="mt-2 text-[0.82rem] text-white/35">Control it from your phone, or play something here to take over.</div>
        </div>
      </div>
    </div>
  )
}
