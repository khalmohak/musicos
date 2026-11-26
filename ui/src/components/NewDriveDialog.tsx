import { FolderPlus, Plus, Usb, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type LibraryOverview, api } from '../lib/api'
import { focusFirst, moveSpatial, useRemote } from '../lib/keys'
import { sfx } from '../lib/sounds'
import { Row } from './ui'

type Drive = LibraryOverview['newDrives'][number]
const size = (b: number) => (b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : `${Math.round(b / 1e9)} GB`)

/** Watches for drives plugged in that aren't in the library yet, and asks what to do with each
 * one once per session: choose folders, add all of it, or "not music" (never ask again). */
export function NewDriveDialog({ enabled, onChoose }: { enabled: boolean; onChoose: (sourceId: string) => void }) {
  const [drive, setDrive] = useState<Drive | null>(null)
  const asked = useRef(new Set<string>())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enabled) return
    const check = () =>
      api.library().then((l) => {
        const d = l.newDrives.find((x) => !asked.current.has(x.id))
        if (d) {
          asked.current.add(d.id)
          setDrive(d)
          sfx.select()
        }
      }).catch(() => {})
    check()
    const t = setInterval(check, 5000)
    return () => clearInterval(t)
  }, [enabled])
  useEffect(() => {
    if (drive) setTimeout(() => focusFirst(ref.current), 60)
  }, [drive])

  useRemote((k) => {
    if (k === 'back') return sfx.back(), setDrive(null), true
    if (k === 'up' || k === 'down') return moveSpatial(ref.current, k) ? (sfx.tick(), true) : (sfx.edge(), true)
    return k !== 'ok' // swallow everything else while the dialog is open
  }, !!drive)

  if (!drive) return null
  const close = () => setDrive(null)
  return (
    <div className="mo-fade-in fixed inset-0 z-40 flex items-center justify-center bg-[rgb(9_9_11/0.78)]">
      <div ref={ref} className="flex w-[40rem] flex-col gap-2.5 rounded-[1.6rem] bg-[rgb(24_24_28)] p-5 shadow-[0_2rem_5rem_-1rem_rgb(0_0_0/0.9)]">
        <div className="flex items-center gap-4 px-3 pt-3 pb-2">
          <div className="flex size-[3.4rem] items-center justify-center rounded-[1rem] bg-white/[0.08]">
            <Usb className="size-[1.7rem]" strokeWidth={1.6} />
          </div>
          <div>
            <div className="text-[1.35rem] font-semibold">New drive: {drive.name}</div>
            <div className="text-[0.92rem] text-white/50">{drive.size ? `${size(drive.size)} · ` : ''}Add its music to your library?</div>
          </div>
        </div>
        <Row icon={FolderPlus} title="Choose folders" sub="Pick the folders your music is in" onClick={() => (sfx.select(), close(), onChoose(drive.id))} />
        <Row icon={Plus} title="Add the whole drive" sub="Everything on it, scanned now" onClick={async () => {
          sfx.select()
          close()
          await api.libraryAdd(drive.id, '').catch(() => {})
        }} />
        <Row icon={X} title="Not music" sub="Don't ask again for this drive" onClick={async () => {
          sfx.back()
          close()
          await api.libraryIgnore(drive.id).catch(() => {})
        }} />
      </div>
    </div>
  )
}
