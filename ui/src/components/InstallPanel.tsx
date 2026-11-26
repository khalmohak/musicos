import { AlertTriangle, CircleCheck, HardDrive, HardDriveDownload, RotateCcw, Usb, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type InstallDisk, type InstallInfo, api } from '../lib/api'
import { focusFirst, useRemote } from '../lib/keys'
import { sfx } from '../lib/sounds'
import { Row } from './ui'

/** Settings → Updates & install: copy musicos from the USB stick onto an internal disk. */
export function InstallPanel() {
  const [info, setInfo] = useState<InstallInfo | null>(null)
  const [confirm, setConfirm] = useState<InstallDisk | null>(null)
  const [msg, setMsg] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const load = () => api.installInfo().then(setInfo).catch(() => {})
  useEffect(() => {
    load()
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [])
  const opened = useRef(false)
  useEffect(() => {
    if (!opened.current) {
      opened.current = true // first render: leave focus where it is
      return
    }
    setTimeout(() => focusFirst(ref.current), 60)
  }, [confirm])
  useRemote((k) => {
    if (confirm && k === 'back') {
      sfx.back()
      setConfirm(null)
      return true
    }
    return false
  }, confirm !== null)

  const st = info?.status
  const busy = st?.state === 'running' || st?.state === 'queued'

  if (busy || st?.state === 'done') {
    const pct = st?.pct ?? 0
    return (
      <div ref={ref} className="flex flex-col gap-3">
        <div className="eyebrow mb-1 px-1">Install on this computer</div>
        <div className="rounded-[1.1rem] bg-white/[0.05] px-6 py-5">
          <div className="flex items-center gap-3 text-[1.1rem] font-medium">
            {st?.state === 'done' ? <CircleCheck className="size-[1.4rem]" strokeWidth={1.75} /> : <HardDriveDownload className="size-[1.4rem]" strokeWidth={1.75} />}
            {st?.state === 'done' ? `Installed on ${st.target}` : st?.step || 'Starting…'}
          </div>
          <div className="mt-4 h-[0.35rem] overflow-hidden rounded-full bg-white/12">
            <div className="h-full rounded-full bg-white/90 transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-3 text-[0.85rem] text-white/50">
            {st?.state === 'done'
              ? 'Turn musicos off, take out the USB stick, then turn it on again. It starts from the new disk, with your settings, Wi-Fi and music.'
              : `${pct}% · Keep musicos on and leave the USB stick in.`}
          </div>
          {st?.warning && <div className="mt-2 text-[0.85rem] text-white/70">{st.warning}</div>}
        </div>
        {st?.state === 'done' && (
          <Row icon={RotateCcw} title="Turn off" sub="Then remove the USB stick and turn it back on" onClick={() => (sfx.select(), api.power('shutdown'))} />
        )}
      </div>
    )
  }

  if (confirm) {
    return (
      <div ref={ref} className="flex flex-col gap-3">
        <div className="eyebrow mb-1 px-1">Install on this computer</div>
        <div className="rounded-[1.1rem] bg-white/[0.05] px-6 py-5">
          <div className="flex items-center gap-3 text-[1.25rem] font-semibold">
            <AlertTriangle className="size-[1.5rem]" strokeWidth={1.75} />
            Erase {confirm.name}?
          </div>
          <div className="mt-2 text-[0.95rem] text-white/60">
            {confirm.kind} · {confirm.sizeText}. Everything on it is deleted and replaced by musicos.
          </div>
          {confirm.parts.length > 0 && (
            <div className="mt-4 flex flex-col gap-1">
              <div className="text-[0.8rem] text-white/40">Currently on this disk</div>
              {confirm.parts.map((p) => (
                <div key={p.name} className="text-[0.9rem] text-white/75">
                  {p.name}
                  {p.mounted.length > 0 && <span className="text-white/40"> · in use as {p.mounted.join(', ')}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <Row icon={X} title="Cancel" autoFocus onClick={() => (sfx.back(), setConfirm(null))} />
        <Row
          icon={HardDriveDownload}
          title={`Erase and install on ${confirm.name}`}
          sub="Takes a few minutes"
          onClick={async () => {
            sfx.select()
            try {
              await api.installTo(confirm)
              setMsg('')
            } catch (e) {
              setMsg((e as Error).message)
            }
            setConfirm(null)
            load()
          }}
        />
      </div>
    )
  }

  return (
    <div ref={ref} className="flex flex-col gap-2">
      <div className="eyebrow mb-1 px-1">Install on this computer</div>
      <div className="mb-2 px-1 text-[0.9rem] leading-relaxed text-white/55">
        {info?.fromUsb === false
          ? `musicos runs from ${info.boot?.name ?? 'an internal disk'}. You can still copy it to another disk.`
          : 'Copies musicos from this USB stick onto a disk in this computer, with your settings, Wi-Fi and the music in its local folder. Updates keep coming over the network.'}
      </div>
      {info === null && <div className="px-1 text-[0.9rem] text-white/40">Looking for disks…</div>}
      {info && info.disks.length === 0 && (
        <div className="px-1 text-[0.9rem] text-white/40">No other disk found. musicos needs at least {info.neededText}.</div>
      )}
      {info?.disks.map((d) => (
        <Row
          key={d.path}
          icon={d.usb ? Usb : HardDrive}
          title={`${d.name} · ${d.sizeText}`}
          sub={d.ok ? `${d.kind} · ${d.parts.length ? d.parts.map((p) => p.name).join(', ') : 'empty'}` : d.why}
          disabled={!d.ok}
          onClick={d.ok ? () => (sfx.select(), setConfirm(d)) : undefined}
        />
      ))}
      <div className="min-h-[1.3rem] px-1 text-[0.82rem] text-white/60">
        {st?.state === 'failed' ? `Install failed: ${st.error}. The USB stick is unchanged; you can try again.` : msg}
      </div>
    </div>
  )
}
