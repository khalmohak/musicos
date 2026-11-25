import { AudioLines, Pause } from 'lucide-react'
import { type Status, coverUrl } from '../lib/api'
import { ReceiverIcon, receiverLabel } from './ReceiverNowPlaying'

/** Compact now-playing capsule for the bottom of the wall. */
export function NowPlayingBar({ status, focused }: { status: Status | null; focused?: boolean }) {
  const rx = status?.receiver
  if (rx) {
    return (
      <div className={`mo-rise relative flex w-[34rem] items-center gap-4 overflow-hidden rounded-[1.1rem] py-2.5 pr-5 pl-2.5 transition-[transform,background-color,color] duration-200 ${focused ? 'scale-[1.04] bg-white text-[rgb(12_12_14)]' : 'bg-[rgb(26_26_30/0.94)] text-white'}`}>
        {rx.cover ? <img src={rx.cover} alt="" className="size-[3.2rem] rounded-[0.6rem] object-cover" /> : <span className="flex size-[3.2rem] items-center justify-center rounded-[0.6rem] bg-white/10"><ReceiverIcon r={rx} className="size-5" /></span>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.95rem] font-semibold">{rx.title || receiverLabel(rx)}</div>
          <div className={`truncate text-[0.8rem] ${focused ? 'text-black/55' : 'text-white/55'}`}>{rx.artist || rx.device}</div>
        </div>
        <ReceiverIcon r={rx} className="size-5 opacity-80" />
      </div>
    )
  }
  const song = status?.song
  if (!song) return null
  const pct = status.duration ? (100 * status.elapsed) / status.duration : 0
  const paused = status.state !== 'play'
  return (
    <div
      className={`mo-rise relative flex w-[34rem] items-center gap-4 overflow-hidden rounded-[1.1rem] py-2.5 pr-5 pl-2.5 transition-[transform,background-color,color] duration-200 ${
        focused ? 'scale-[1.04] bg-white text-[rgb(12_12_14)]' : 'bg-[rgb(26_26_30/0.94)] text-white'
      }`}
    >
      <img src={coverUrl(song.file, 0.04)} alt="" className="size-[3.2rem] rounded-[0.6rem] object-cover" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.95rem] font-semibold">{song.title}</div>
        <div className={`truncate text-[0.8rem] ${focused ? 'text-black/55' : 'text-white/55'}`}>{song.artist}</div>
      </div>
      {paused ? (
        <Pause className="size-5 opacity-70" strokeWidth={2} />
      ) : (
        <AudioLines className="size-5 opacity-80" strokeWidth={2} style={{ color: focused ? undefined : 'rgb(var(--mo-accent))' }} />
      )}
      <div className="absolute inset-x-0 bottom-0 h-[2px] bg-current/10">
        <div className="h-full bg-current/60 transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
