import { Airplay, AlertTriangle, AudioLines, Eraser, HardDriveDownload, X, Bluetooth, Clock, FileText, Gamepad2, Info, Library, MonitorPlay, RefreshCw, RotateCcw, SquareTerminal, Tv, Wifi } from 'lucide-react'
import { RemoteIcon } from '../components/icons'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { AccessCard, BluetoothPanel, DisplayPanel, LibraryPanel, NetworkExtras, NetworkPanel, ReceiversPanel, SoundPanel, TimezonePicker, UpdatePanel } from '../components/panels'
import { InstallPanel } from '../components/InstallPanel'
import { Record, Wordmark } from '../components/Record'
import { Row } from '../components/ui'
import { PhotoBackdrop } from '../components/PhotoBackdrop'
import { BACKDROPS } from '../lib/backgrounds'
import { type Access, type Config, api } from '../lib/api'
import { focusFirst, moveSpatial, useRemote } from '../lib/keys'
import { sfx } from '../lib/sounds'

const SECTIONS = [
  { id: 'audio', label: 'Audio', icon: AudioLines },
  { id: 'streaming', label: 'AirPlay & Spotify', icon: Airplay },
  { id: 'network', label: 'Network', icon: Wifi },
  { id: 'bluetooth', label: 'Bluetooth', icon: Bluetooth },
  { id: 'library', label: 'Library & drives', icon: Library },
  { id: 'display', label: 'Display & sleep', icon: MonitorPlay },
  { id: 'time', label: 'Time zone', icon: Clock },
  { id: 'remote', label: 'Remotes & controllers', icon: Gamepad2 },
  { id: 'access', label: 'Copy music in', icon: SquareTerminal },
  { id: 'system', label: 'Updates & install', icon: HardDriveDownload },
  { id: 'about', label: 'About', icon: Info },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

export function Settings({
  config, onConfig, onBack, onRerunSetup,
  onSources,
}: { config: Config; onConfig: (c: Config) => void; onBack: () => void; onRerunSetup: () => void; onSources: () => void }) {
  const [section, setSection] = useState<SectionId>(() => (new URLSearchParams(location.search).get('section') as SectionId) || 'audio')
  const [zone, setZone] = useState<'nav' | 'panel'>('nav')
  const nav = useRef<HTMLDivElement>(null)
  const [updateReady, setUpdateReady] = useState(false)
  useEffect(() => {
    api.update().then((u) => setUpdateReady(!!u.available || u.install === 'installed')).catch(() => {})
  }, [])
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    nav.current?.querySelector<HTMLElement>(`[data-section="${section}"]`)?.focus()
  }, [])

  useRemote((k) => {
    if (k === 'back') {
      if (zone === 'panel') {
        setZone('nav')
        nav.current?.querySelector<HTMLElement>(`[data-section="${section}"]`)?.focus()
      } else onBack()
      sfx.back()
      return true
    }
    if (zone === 'nav') {
      if (k === 'up' || k === 'down') {
        const i = SECTIONS.findIndex((s) => s.id === section)
        const n = Math.max(0, Math.min(SECTIONS.length - 1, i + (k === 'down' ? 1 : -1)))
        if (n === i) return sfx.edge(), true
        setSection(SECTIONS[n].id)
        nav.current?.querySelector<HTMLElement>(`[data-section="${SECTIONS[n].id}"]`)?.focus()
        sfx.tick()
        return true
      }
      if (k === 'right' || k === 'ok') {
        if (panel.current?.querySelector('[data-nav]:not([disabled])')) {
          setZone('panel')
          focusFirst(panel.current)
          sfx.tick()
        } else sfx.edge()
        return true
      }
      return false
    }
    if (k === 'up' || k === 'down' || k === 'left' || k === 'right') {
      if (moveSpatial(panel.current, k)) return sfx.tick(), true
      if (k === 'left') {
        setZone('nav')
        nav.current?.querySelector<HTMLElement>(`[data-section="${section}"]`)?.focus({ preventScroll: true })
        sfx.tick()
        return true
      }
      return sfx.edge(), true
    }
    return false
  })

  return (
    <div className="tv relative flex h-full">
      <PhotoBackdrop index={1} dim={0.86} drift={false} />
      <aside ref={nav} className="no-scrollbar relative flex w-[27rem] shrink-0 flex-col gap-1.5 overflow-y-auto px-[3vw] pt-[7vh] pb-[6vh]">
        <h1 className="mb-8 px-3 text-[2.3rem] font-semibold tracking-[-0.02em]">Settings</h1>
        {SECTIONS.map((s) => {
          const active = section === s.id
          return (
            <button
              key={s.id}
              type="button"
              data-section={s.id}
              tabIndex={-1}
              onClick={() => {
                sfx.tick()
                setSection(s.id)
                setZone('panel')
                setTimeout(() => focusFirst(panel.current), 60)
              }}
              className={`flex items-center gap-4 rounded-[1rem] px-5 py-[0.95rem] text-left text-[1.05rem] transition-[transform,background-color,color] duration-300 ease-[var(--mo-spring)] ${
                active && zone === 'nav'
                  ? 'scale-[1.03] bg-white text-[rgb(12_12_14)]'
                  : active
                    ? 'bg-white/12 text-white'
                    : 'text-white/55'
              }`}
            >
              <s.icon className="size-[1.3rem]" strokeWidth={1.75} />
              {s.label}
              {s.id === 'system' && updateReady && <span className="ml-auto size-2 rounded-full bg-current" />}
            </button>
          )
        })}
      </aside>
      <section ref={panel} key={section} className="no-scrollbar mo-fade-in relative flex-1 overflow-y-auto pt-[7vh] pr-[6vw] pb-[10vh] pl-[3vw]">
        <div className="max-w-[54rem]">
          <h2 className="mb-9 text-[2.3rem] font-semibold tracking-[-0.02em] text-white/90">
            {SECTIONS.find((x) => x.id === section)?.label}
          </h2>
          {section === 'audio' && <SoundPanel config={config} onConfig={onConfig} />}
          {section === 'network' && (
            <div className="flex flex-col gap-8">
              <NetworkPanel />
              <NetworkExtras />
            </div>
          )}
          {section === 'bluetooth' && <BluetoothPanel />}
          {section === 'streaming' && <ReceiversPanel />}
          {section === 'time' && <TimezonePicker />}
          {section === 'library' && <LibraryPanel onSources={onSources} />}
          {section === 'access' && <AccessSection />}
          {section === 'display' && <DisplayPanel config={config} onConfig={onConfig} />}
          {section === 'remote' && <RemoteSection />}
          {section === 'system' && (
            <div className="flex flex-col gap-10">
              <UpdatePanel />
              <InstallPanel />
            </div>
          )}
          {section === 'about' && <About onRerunSetup={onRerunSetup} />}
        </div>
      </section>
    </div>
  )
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/[0.07] px-1 py-3 text-[0.95rem]">
      <span className="text-white/50">{k}</span>
      <span className="font-mono text-[0.85rem] text-white/85">{v}</span>
    </div>
  )
}

function AccessSection() {
  const [a, setA] = useState<Access | null>(null)
  useEffect(() => {
    api.access().then(setA).catch(() => {})
  }, [])
  return (
    <div className="flex flex-col gap-6">
      <AccessCard />
      <div>
        <KV k="Address" v={a?.ips.join(', ') || '—'} />
        <KV k="Name on the network" v={a?.mdns ?? '—'} />
        <KV k="SSH" v={a?.ssh ? `${a.user}@${a.ips[0] ?? a.mdns}` : 'off'} />
        <KV k="Drop folder" v={a?.dropFolder ?? '—'} />
      </div>
    </div>
  )
}

function About({ onRerunSetup }: { onRerunSetup: () => void }) {
  const [a, setA] = useState<Access | null>(null)
  useEffect(() => {
    api.access().then(setA).catch(() => {})
  }, [])
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-5">
        <Record size="4.5rem" spinning={false} />
        <div>
          <Wordmark className="text-[1rem]" />
          <div className="mt-1 text-[0.85rem] text-white/45">{a?.hostname ?? ''}</div>
        </div>
      </div>
      <div className="flex flex-col gap-1 px-1">
        <div className="eyebrow mb-1">Photography</div>
        {BACKDROPS.map((b) => (
          <div key={b.src} className="text-[0.82rem] text-white/50">
            {b.by} · Unsplash
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <Row icon={RotateCcw} title="Run setup again" sub="Name, time zone, network, output, music sources" onClick={onRerunSetup} />
      </div>
      <ResetSection />
      <Diagnostics />
    </div>
  )
}

/** Hardware report: also saved to the USB stick as musicos-report.txt for reading on a computer. */
function Diagnostics() {
  const [r, setR] = useState<{ text: string; at: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => api.report().then(setR).catch(() => setR({ text: '', at: 0 }))
  useEffect(() => {
    load()
  }, [])
  return (
    <div className="flex flex-col gap-2">
      <div className="eyebrow mb-1 px-1">Diagnostics</div>
      <Row
        icon={busy ? RefreshCw : FileText}
        title={busy ? 'Collecting…' : 'Refresh hardware report'}
        sub={r?.at ? `Last run ${new Date(r.at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Also saved on the USB stick as musicos-report.txt.` : 'Graphics, sound, network, drives and controllers.'}
        onClick={async () => {
          sfx.select()
          setBusy(true)
          await api.refreshReport().catch(() => {})
          setTimeout(() => load().finally(() => setBusy(false)), 6000)
        }}
      />
      {r?.text && (
        <pre className="mt-2 max-h-[46vh] overflow-auto rounded-[0.9rem] bg-black/40 p-4 font-mono text-[0.62rem] leading-relaxed whitespace-pre-wrap text-white/70">{r.text}</pre>
      )}
    </div>
  )
}

const MAPPING: [string, string][] = [
  ['D-pad / left stick', 'Move'],
  ['A  ·  Cross', 'Select'],
  ['B  ·  Circle', 'Back'],
  ['Y  ·  Triangle', 'Now playing / lyrics'],
  ['X  ·  Square', 'Search'],
  ['View  ·  Share', 'Settings'],
  ['Menu  ·  Options', 'Play / pause'],
  ['LB / RB', 'Previous / next song'],
  ['LT / RT', 'Volume down / up'],
  ['Guide  ·  PS', 'Home  ·  hold for power menu'],
]

function RemoteSection() {
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <div className="eyebrow mb-1 px-1">Works automatically</div>
        <Row icon={Gamepad2} title="Game controllers" sub="Xbox, PlayStation, 8BitDo and most pads. USB: plug in. Bluetooth: pair in Settings → Bluetooth." />
        <Row icon={Tv} title="TV remote (HDMI-CEC)" sub="Your TV's remote controls musicos, and the TV turns on when music starts. Needs a CEC-capable HDMI port or a Pulse-Eight adapter." />
        <Row icon={RemoteIcon} title="IR remotes" sub="IR receivers and FLIRC dongles appear as keys. A keyboard works too." />
      </div>
      <div>
        <div className="eyebrow mb-3 px-1">Controller buttons</div>
        {MAPPING.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between border-b border-white/[0.07] px-1 py-2.5 text-[0.95rem]">
            <span className="text-white/55">{k}</span>
            <span className="text-white/85">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const RESETS = {
  settings: {
    title: 'Reset settings',
    sub: 'Wi-Fi, Bluetooth, network shares, sound and display choices. Your library stays.',
    erases: ['Settings and your name', 'Saved Wi-Fi networks', 'Bluetooth pairings', 'Network shares and their passwords', 'AirPlay / Spotify name'],
    keeps: ['All music and drives', 'The library (no rescan needed)', 'The installed version and updates'],
  },
  everything: {
    title: 'Erase everything',
    sub: 'Like new: settings plus the music copied onto this device and the library.',
    erases: ['Everything in "Reset settings"', 'Music copied onto this device (local folder)', 'The library index (scanned again)', 'Playback history and queue'],
    keeps: ['Music on USB drives, other disks and network shares', 'The installed version and updates'],
  },
} as const

/** Settings > About: reset settings, or everything, then restart into setup. */
function ResetSection() {
  const [confirm, setConfirm] = useState<keyof typeof RESETS | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useRemote((k) => {
    if (confirm && k === 'back') {
      sfx.back()
      setConfirm(null)
      return true
    }
    return false
  }, confirm !== null)
  const opened = useRef(false)
  useEffect(() => {
    // move focus only when the confirm screen opens/closes, never when About is first shown
    if (!opened.current) {
      opened.current = true
      return
    }
    setTimeout(() => focusFirst(ref.current), 60)
  }, [confirm])

  if (busy) {
    return <div className="rounded-[1.1rem] bg-white/[0.05] px-6 py-5 text-[1.05rem]">Resetting… musicos restarts in a moment.</div>
  }
  if (confirm) {
    const r = RESETS[confirm]
    return (
      <div ref={ref} className="flex flex-col gap-3">
        <div className="rounded-[1.1rem] bg-white/[0.05] px-6 py-5">
          <div className="flex items-center gap-3 text-[1.25rem] font-semibold">
            <AlertTriangle className="size-[1.5rem]" strokeWidth={1.75} />
            {r.title}?
          </div>
          <div className="mt-4 grid grid-cols-2 gap-8 text-[0.9rem]">
            <div>
              <div className="mb-1.5 text-white/40">Deleted</div>
              {r.erases.map((x) => <div key={x} className="text-white/80">{x}</div>)}
            </div>
            <div>
              <div className="mb-1.5 text-white/40">Kept</div>
              {r.keeps.map((x) => <div key={x} className="text-white/60">{x}</div>)}
            </div>
          </div>
        </div>
        <Row icon={X} title="Cancel" autoFocus onClick={() => (sfx.back(), setConfirm(null))} />
        <Row
          icon={Eraser}
          title={`${r.title} and restart`}
          onClick={async () => {
            sfx.select()
            setBusy(true)
            await api.reset(confirm).catch(() => setBusy(false))
          }}
        />
      </div>
    )
  }
  return (
    <div ref={ref} className="flex flex-col gap-2">
      <div className="eyebrow mb-1 px-1">Reset</div>
      {(Object.keys(RESETS) as (keyof typeof RESETS)[]).map((k) => (
        <Row key={k} icon={Eraser} title={RESETS[k].title} sub={RESETS[k].sub} onClick={() => (sfx.select(), setConfirm(k))} />
      ))}
    </div>
  )
}
