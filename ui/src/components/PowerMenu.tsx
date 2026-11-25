import { Moon, Power, RotateCcw, TvMinimal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { focusFirst, moveFocus, useRemote } from '../lib/keys'
import { sfx } from '../lib/sounds'
import { Row } from './ui'

/** Power sheet: sleep, restart, shut down, TV off. Opened by holding Guide, a remote's power
 * key, or the power button in the home header. */
export function PowerMenu({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [going, setGoing] = useState<string | null>(null)
  useEffect(() => {
    const t = setTimeout(() => focusFirst(ref.current), 30)
    return () => clearTimeout(t)
  }, [])
  useRemote((k) => {
    if (going) return true
    if (k === 'back' || k === 'power') return sfx.back(), onClose(), true
    if (k === 'up' || k === 'left') return moveFocus(ref.current, -1) ? (sfx.tick(), true) : (sfx.edge(), true)
    if (k === 'down' || k === 'right') return moveFocus(ref.current, 1) ? (sfx.tick(), true) : (sfx.edge(), true)
    return k !== 'ok' // OK goes to the focused row; everything else is swallowed by the sheet
  })
  const act = (action: 'shutdown' | 'reboot' | 'sleep' | 'tv-off', label: string) => async () => {
    sfx.select()
    if (action === 'tv-off') {
      await api.power(action).catch(() => {})
      return onClose()
    }
    setGoing(label)
    await api.power(action).catch(() => setGoing(null))
  }
  return (
    <div className="tv fixed inset-0 z-30 flex items-center justify-center bg-black/70 mo-fade-in">
      {going ? (
        <div className="text-center">
          <div className="text-[2rem] font-semibold">{going}…</div>
          <div className="mt-3 text-white/55">It's safe to unplug once the screen goes dark.</div>
        </div>
      ) : (
        <div ref={ref} className="mo-rise w-[30rem] rounded-[1.6rem] bg-[rgb(22_22_26)] p-5 shadow-2xl">
          <div className="mb-4 px-2 text-[1.3rem] font-semibold">Power</div>
          <div className="flex flex-col gap-2">
            <Row icon={Moon} title="Sleep" sub="Wake with the keyboard, controller or power button" onClick={act('sleep', 'Going to sleep')} autoFocus />
            <Row icon={TvMinimal} title="Turn off TV" sub="Music keeps playing (HDMI-CEC)" onClick={act('tv-off', '')} />
            <Row icon={RotateCcw} title="Restart" onClick={act('reboot', 'Restarting')} />
            <Row icon={Power} title="Shut down" onClick={act('shutdown', 'Shutting down')} />
            <Row icon={X} title="Cancel" onClick={() => (sfx.back(), onClose())} />
          </div>
        </div>
      )}
    </div>
  )
}
