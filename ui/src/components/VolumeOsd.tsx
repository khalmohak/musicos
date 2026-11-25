import { Volume, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/** Shows briefly whenever the volume changes (remote, controller triggers, phone). */
export function VolumeOsd({ volume }: { volume: number | undefined }) {
  const [shown, setShown] = useState(false)
  const prev = useRef(volume)
  useEffect(() => {
    if (volume === undefined || volume < 0) return
    if (prev.current !== undefined && prev.current !== volume) {
      setShown(true)
      const t = setTimeout(() => setShown(false), 1600)
      prev.current = volume
      return () => clearTimeout(t)
    }
    prev.current = volume
  }, [volume])
  if (volume === undefined || volume < 0) return null
  const Icon = volume === 0 ? VolumeX : volume < 34 ? Volume : volume < 67 ? Volume1 : Volume2
  return (
    <div
      className="pointer-events-none fixed top-[5vh] right-[4.5vw] z-50 flex items-center gap-4 rounded-full bg-[rgb(26_26_30/0.96)] py-3 pr-6 pl-4 shadow-2xl transition-[opacity,transform] duration-300"
      style={{ opacity: shown ? 1 : 0, transform: shown ? 'translateY(0)' : 'translateY(-0.6rem)' }}
    >
      <Icon className="size-[1.4rem]" strokeWidth={1.9} />
      <div className="h-[0.4rem] w-[11rem] overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full bg-white transition-[width] duration-200" style={{ width: `${volume}%` }} />
      </div>
      <span className="w-[2.4rem] text-right text-[0.95rem] tabular-nums text-white/75">{volume}</span>
    </div>
  )
}
