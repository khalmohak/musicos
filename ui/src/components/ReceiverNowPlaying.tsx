import { Airplay, Radio, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type Receiver, fmtTime } from '../lib/api'
import { setAccentFrom } from '../lib/color'
import { Record } from './Record'

export const receiverLabel = (r: Receiver) => (r.source === 'airplay' ? 'AirPlay' : 'Spotify Connect')
export const ReceiverIcon = ({ r, className }: { r: Receiver; className?: string }) =>
  r.source === 'airplay' ? <Airplay className={className} strokeWidth={1.9} /> : <Radio className={className} strokeWidth={1.9} />

/** Full-screen now playing for music streamed from a phone (AirPlay / Spotify Connect). */
export function ReceiverNowPlaying({ r }: { r: Receiver }) {
  const [coverOk, setCoverOk] = useState(true)
  useEffect(() => {
    setCoverOk(true)
    if (r.cover) setAccentFrom(r.cover)
  }, [r.cover])
  const playing = r.state === 'play'
  const pct = r.duration ? (100 * r.position) / r.duration : 0
  const size = 'min(62vh, 34vw)'
  return (
    <div className="tv relative h-full overflow-hidden">
      {r.cover && coverOk && (
        <img src={r.cover} alt="" className="mo-backdrop opacity-40" style={{ filter: 'blur(60px) saturate(1.3)' }} />
      )}
      <div className="absolute inset-0 bg-[rgb(9_9_11/0.6)]" />
      <div className="relative flex h-full items-center gap-[4vw] px-[7vw]">
        <div className={`relative shrink-0 ${playing ? '' : 'mo-paused'}`} style={{ width: size, height: size }}>
          <div className="absolute top-[3%] left-0 h-[94%] w-[94%] transition-transform duration-[1400ms]" style={{ transform: playing ? 'translateX(36%)' : 'translateX(6%)' }}>
            <Record size="100%" accent />
          </div>
          {r.cover && coverOk ? (
            <img src={r.cover} alt="" onError={() => setCoverOk(false)} className="relative aspect-square w-full rounded-[0.6rem] object-cover shadow-[0_2.5rem_5rem_-1rem_rgb(0_0_0/0.85)]" />
          ) : (
            <div className="relative flex aspect-square w-full items-center justify-center rounded-[0.6rem] bg-[rgb(28_28_32)]">
              <ReceiverIcon r={r} className="size-1/4 text-white/30" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 pl-[8vw]">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[0.8rem] font-medium">
            <ReceiverIcon r={r} className="size-[1rem]" />
            {receiverLabel(r)}
            {r.device && <span className="text-white/55">· {r.device}</span>}
          </span>
          <h1 className="mt-5 line-clamp-2 text-[2.9rem] leading-[1.05] font-semibold tracking-[-0.025em]">{r.title || 'Streaming'}</h1>
          <div className="mt-3 text-[1.3rem] text-white/80">{r.artist}</div>
          <div className="mt-1 text-[1rem] text-white/45">{r.album}</div>
          {r.duration > 0 && (
            <div className="mt-10 max-w-[34rem]">
              <div className="h-[5px] overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-white/85" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2.5 flex justify-between text-[0.85rem] tabular-nums text-white/50">
                <span>{fmtTime(r.position)}</span>
                <span>-{fmtTime(r.duration - r.position)}</span>
              </div>
            </div>
          )}
          <div className="mt-10 inline-flex items-center gap-2 text-[0.9rem] text-white/50">
            <Smartphone className="size-[1.1rem]" strokeWidth={1.75} />
            {playing ? 'Control playback from your phone' : 'Paused on your phone'} · play something here to take over
          </div>
        </div>
      </div>
    </div>
  )
}
