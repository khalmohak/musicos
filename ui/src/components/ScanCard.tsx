import { AlertCircle, CircleCheck, FolderSearch, Music2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type ScanStatus, api } from '../lib/api'

const n = (x: number) => x.toLocaleString()

export function fmtEta(s: number | null) {
  if (s === null) return ''
  if (s < 45) return 'less than a minute left'
  const m = Math.round(s / 60)
  if (m < 60) return `about ${m} min left`
  const h = Math.floor(m / 60)
  return `about ${h} h ${m % 60} min left`
}

function ago(t: number) {
  const d = new Date(t * 1000)
  const today = new Date().toDateString() === d.toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return today ? `today ${time}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`
}

function took(s: number) {
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`
}

/** Live scan state, polled once a second while a scan runs (every 4 s otherwise). */
export function useScan() {
  const [s, setS] = useState<ScanStatus | null>(null)
  useEffect(() => {
    let alive = true
    let t = 0
    const tick = async () => {
      const r = await api.scan().catch(() => null)
      if (!alive) return
      setS(r)
      t = window.setTimeout(tick, r?.active ? 1000 : 4000)
    }
    tick()
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [])
  return s
}

/** What the library scan is doing: counting files, reading tags (how far, what, how long). */
export function ScanCard({ s, compact = false }: { s: ScanStatus | null; compact?: boolean }) {
  if (!s) return null
  if (!s.active) {
    const l = s.last
    if (!l || compact) return null
    const changes = [l.added && `${n(l.added)} added`, l.updated && `${n(l.updated)} re-read`, l.removed && `${n(l.removed)} removed`].filter(Boolean).join(' · ')
    return (
      <div className="flex flex-col gap-2 rounded-[1.1rem] bg-white/[0.04] px-6 py-4">
        <div className="flex items-center gap-3 text-[0.95rem] text-white/80">
          <CircleCheck className="size-[1.15rem] shrink-0 opacity-70" strokeWidth={1.75} />
          Last scan {ago(l.at)} · took {took(l.seconds)}
        </div>
        <div className="pl-[1.9rem] text-[0.85rem] text-white/50">{changes || 'Nothing new'}</div>
        {l.errors > 0 && <ScanErrors errors={s.errors} count={l.errors} />}
      </div>
    )
  }

  const counting = s.phase === 'counting' && !s.counted
  const pct = s.pct ?? 0
  return (
    <div className={`flex flex-col rounded-[1.1rem] bg-white/[0.06] ${compact ? 'gap-3 px-7 py-6' : 'gap-3 px-6 py-5'}`}>
      <div className="flex items-baseline justify-between gap-6">
        <div className="flex items-center gap-3 text-[1.1rem] font-medium">
          {counting ? <FolderSearch className="size-[1.3rem] shrink-0" strokeWidth={1.75} /> : <Music2 className="size-[1.3rem] shrink-0" strokeWidth={1.75} />}
          {counting ? 'Looking for music…' : 'Reading your music'}
        </div>
        {!counting && s.pct !== null && <div className="text-[1.5rem] font-semibold tabular-nums">{pct}%</div>}
      </div>

      <div className="h-[0.35rem] overflow-hidden rounded-full bg-white/12">
        {counting || s.pct === null ? (
          <div className="mo-indeterminate h-full w-1/3 rounded-full bg-white/70" />
        ) : (
          <div className="h-full rounded-full bg-white/90 transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
        )}
      </div>

      <div className="flex justify-between gap-6 text-[0.85rem] tabular-nums text-white/55">
        <span>
          {counting
            ? `${n(s.found)} tracks found so far`
            : s.total
              ? `${n(s.done)} of ${n(s.total)} tracks${s.rate >= 1 ? ` · ${Math.round(s.rate)} per second` : ''}`
              : `${n(s.added + s.updated)} tracks read`}
        </span>
        <span>{fmtEta(s.eta)}</span>
      </div>

      {s.current && (
        <div className="min-w-0 truncate text-[0.9rem] text-white/75">
          <span className="text-white/40">{s.source} · </span>
          {s.current}
        </div>
      )}
      {!compact && s.errors.length > 0 && <ScanErrors errors={s.errors} count={s.errors.length} />}
      {compact && <div className="text-[0.8rem] text-white/40">Albums appear as they're read. You can play music meanwhile.</div>}
    </div>
  )
}

function ScanErrors({ errors, count }: { errors: string[]; count: number }) {
  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[0.85rem] text-white/70">
        <AlertCircle className="size-[1rem] shrink-0" strokeWidth={1.75} />
        {count === 1 ? '1 file could not be read' : `${n(count)} files could not be read`}
      </div>
      {errors.slice(-4).map((e) => (
        <div key={e} className="truncate pl-6 font-mono text-[0.72rem] text-white/40">
          {e}
        </div>
      ))}
    </div>
  )
}
