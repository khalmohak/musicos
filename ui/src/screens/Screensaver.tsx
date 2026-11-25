import { useEffect, useState } from 'react'
import { Cover } from '../components/Cover'
import { PhotoBackdrop } from '../components/PhotoBackdrop'
import { type Album, type Status, backdropUrl } from '../lib/api'

/**
 * Idle screen. Playing: the cover and title, slowly changing position (OLED-friendly).
 * Idle: a slow slideshow of photographs with the time. Any button wakes it (handled in App).
 */
export function Screensaver({ status }: { status: Status | null; albums?: Album[] }) {
  const [now, setNow] = useState(() => new Date())
  const [spot, setSpot] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10000)
    const s = setInterval(() => setSpot((x) => x + 1), 45000) // move every 45 s: no burn-in
    return () => {
      clearInterval(t)
      clearInterval(s)
    }
  }, [])
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const date = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
  const song = status?.state === 'play' ? status.song : null


  const corners = ['left-[7vw] bottom-[9vh]', 'right-[7vw] bottom-[9vh] text-right', 'right-[7vw] top-[9vh] text-right', 'left-[7vw] top-[9vh]']
  const corner = corners[spot % corners.length]

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-black mo-fade-in">
      {song ? (
        <>
          <img key={song.file} src={backdropUrl(song.file)} alt="" className="mo-backdrop opacity-50" />
          <div className="absolute inset-0 bg-black/45" />
          <div
            className="absolute flex items-center gap-[3vw] transition-all duration-[3000ms] ease-in-out"
            style={{ left: `${10 + (spot % 3) * 6}vw`, top: `${16 + ((spot + 1) % 3) * 5}vh` }}
          >
            <Cover file={song.file} title={song.album} artist={song.artist} fraction={0.3} eager className="size-[min(52vh,30vw)] rounded-[0.8rem] shadow-[0_2.5rem_5rem_-1rem_rgb(0_0_0/0.9)]" />
            <div className="max-w-[34vw]">
              <div className="text-[2.6rem] leading-tight font-semibold tracking-[-0.025em]">{song.title}</div>
              <div className="mt-2 text-[1.3rem] text-white/75">{song.artist}</div>
              <div className="mt-1 text-[1rem] text-white/45">{song.album}</div>
              <div className="mt-8 text-[1.4rem] font-light tabular-nums text-white/60">{time}</div>
            </div>
          </div>
        </>
      ) : (
        <>
          <PhotoBackdrop index={spot} dim={0.42} />
          <div className={`absolute transition-all duration-[3000ms] ${corner}`}>
            <div className="text-[5rem] leading-none font-light tracking-[-0.03em] tabular-nums">{time}</div>
            <div className="mt-3 text-[1.2rem] text-white/60">{date}</div>
          </div>
        </>
      )}
    </div>
  )
}
