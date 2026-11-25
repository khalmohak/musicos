import { ArrowRight, Cpu, FileAudio, type LucideIcon, Speaker } from 'lucide-react'
import type { ReactNode } from 'react'
import { type AudioFormat, type Status, fmtFormat, isHiRes } from '../lib/api'

/** Focusable list row: icon, title, subtitle, trailing slot. Turns white when focused (tvOS). */
export function Row({
  icon: Icon, title, sub, trailing, onClick, autoFocus, disabled,
}: {
  icon?: LucideIcon | ((p: { className?: string; strokeWidth?: number }) => ReactNode)
  title: ReactNode
  sub?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  autoFocus?: boolean
  disabled?: boolean
}) {
  if (!onClick) {
    // display-only: same look, never takes focus
    return (
      <div className="row bg-white/[0.035]!">
        {Icon && <Icon className="size-[1.45rem] shrink-0 opacity-60" strokeWidth={1.75} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[1.02rem] font-medium">{title}</span>
          {sub && <span className="sub block truncate text-[0.8rem]">{sub}</span>}
        </span>
        {trailing}
      </div>
    )
  }
  return (
    <button
      type="button"
      data-nav
      data-autofocus={autoFocus ? '' : undefined}
      disabled={disabled}
      onClick={onClick}
      className="row"
    >
      {Icon && <Icon className="size-[1.45rem] shrink-0 opacity-80" strokeWidth={1.75} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[1.02rem] font-medium">{title}</span>
        {sub && <span className="sub block truncate text-[0.8rem]">{sub}</span>}
      </span>
      {trailing}
    </button>
  )
}

/** Visual on/off pill for a Row (the whole row is the control). */
export function Toggle({ on }: { on: boolean }) {
  return (
    <span className="relative inline-flex h-[1.6rem] w-[2.7rem] shrink-0 items-center rounded-full bg-current/20 transition-colors">
      <span
        className="absolute size-[1.25rem] rounded-full bg-current transition-transform duration-200"
        style={{ transform: `translateX(${on ? '1.27rem' : '0.18rem'})`, opacity: on ? 1 : 0.45 }}
      />
    </span>
  )
}

export function PageDots({ count, current }: { count: number; current: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="h-[0.42rem] rounded-full bg-white transition-all duration-300"
          style={{ width: i === current ? '1.4rem' : '0.42rem', opacity: i === current ? 0.9 : i < current ? 0.45 : 0.18 }}
        />
      ))}
    </div>
  )
}

/**
 * Setup page. Centered (icon, title, content) for simple steps; `split` puts the title on the
 * left and a scrolling list on the right, like tvOS Settings, so tall lists never push the
 * heading off screen. `actions` (e.g. Continue) come after the list in focus order.
 */
export function StepShell({
  icon, title, sub, children, wide, split, actions,
}: {
  icon: ReactNode
  title: ReactNode
  sub?: ReactNode
  children?: ReactNode
  wide?: boolean
  split?: boolean
  actions?: ReactNode
}) {
  if (split) {
    return (
      <div className="mo-rise grid h-full w-full max-w-[96rem] grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)] gap-[5vw]">
        <div className="no-scrollbar order-2 flex max-h-full flex-col justify-center overflow-y-auto py-[4vh] pr-2 pl-1">
          {children}
          {actions && <div className="mt-6 flex">{actions}</div>}
        </div>
        <div className="order-1 flex flex-col justify-center">
          <div className="mb-7 flex size-[4.6rem] items-center justify-center rounded-[1.3rem] bg-white/[0.07]">{icon}</div>
          <h1 className="text-[2.5rem] leading-[1.08] font-semibold tracking-[-0.025em]">{title}</h1>
          {sub && <p className="mt-4 max-w-[30rem] text-[1.05rem] leading-relaxed text-white/55">{sub}</p>}
        </div>
      </div>
    )
  }
  return (
    <div className={`mo-rise mx-auto flex w-full flex-col items-center text-center ${wide ? 'max-w-[64rem]' : 'max-w-[38rem]'}`}>
      <div className="mb-6 flex size-[4.6rem] items-center justify-center rounded-[1.3rem] bg-white/[0.07]">{icon}</div>
      <h1 className="text-[2.35rem] leading-[1.1] font-semibold tracking-[-0.02em]">{title}</h1>
      {sub && <p className="mt-3 max-w-[34rem] text-[1.02rem] leading-relaxed text-white/55">{sub}</p>}
      {children && <div className="mt-9 w-full text-left">{children}</div>}
    </div>
  )
}

/** Small capsule: "FLAC", "Hi-Res", "24/96". */
export function Badge({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <span
      className={`inline-flex h-[1.45rem] items-center rounded-[0.45rem] px-[0.55rem] text-[0.68rem] font-semibold tracking-[0.06em] uppercase ${
        strong ? 'bg-white text-[rgb(12_12_14)]' : 'bg-white/10 text-white/75'
      }`}
    >
      {children}
    </span>
  )
}

export function FormatBadges({ codec, format }: { codec?: string; format?: AudioFormat | null }) {
  if (!codec && !format) return null
  return (
    <span className="inline-flex items-center gap-1.5">
      {isHiRes(format) && <Badge strong>Hi-Res</Badge>}
      {codec && <Badge>{codec}</Badge>}
      {format && <Badge>{fmtFormat(format).replace(' / ', ' · ')}</Badge>}
    </span>
  )
}

/**
 * The audio path, Roon-style: file → MPD → output. Green when nothing alters the signal.
 */
export function SignalPath({
  status, outputName, bitPerfect,
}: { status: Status; outputName: string; bitPerfect: boolean }) {
  const src = status.song?.format
  const out = status.audio
  const resampled = !!src && !!out && (src.rate !== out.rate || src.bits !== out.bits)
  const untouched = bitPerfect && !resampled
  const compact = (f?: AudioFormat | null) =>
    !f ? '' : f.dsd ? f.dsd : `${f.float ? '32f' : f.bits}/${Number.isInteger(f.rate / 1000) ? f.rate / 1000 : (f.rate / 1000).toFixed(1)}`
  const steps: { icon: LucideIcon; label: string; detail: string }[] = [
    { icon: FileAudio, label: status.song?.codec || 'Source', detail: compact(src) },
    { icon: Cpu, label: untouched ? 'Bit-perfect' : resampled ? 'Resampled' : 'Software volume', detail: resampled ? compact(out) : '' },
    { icon: Speaker, label: outputName, detail: '' },
  ]
  return (
    <div className="inline-flex items-center gap-3 rounded-full bg-black/30 px-5 py-2.5 whitespace-nowrap">
      <span
        className="size-[0.55rem] shrink-0 rounded-full"
        style={{ background: untouched ? 'rgb(74 222 128)' : 'rgb(250 204 21)' }}
        title={untouched ? 'Bit-perfect' : 'Signal is altered'}
      />
      {steps.map((s, i) => (
        <span key={s.label + i} className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-2">
            <s.icon className="size-[1rem] text-white/55" strokeWidth={1.75} />
            <span className="text-[0.82rem] text-white/80">{s.label}</span>
            {s.detail && <span className="text-[0.78rem] tabular-nums text-white/45">{s.detail}</span>}
          </span>
          {i < steps.length - 1 && <ArrowRight className="size-[0.85rem] text-white/25" strokeWidth={2} />}
        </span>
      ))}
    </div>
  )
}
