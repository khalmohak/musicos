import { Airplay, AudioLines, Bluetooth, Clock, FileText, Gamepad2, Info, Library, MonitorPlay, RefreshCw, RotateCcw, SquareTerminal, Tv, Wifi } from 'lucide-react'
import { RemoteIcon } from '../components/icons'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { AccessCard, BluetoothPanel, DisplayPanel, LibraryPanel, NetworkExtras, NetworkPanel, ReceiversPanel, SoundPanel, TimezonePicker, UpdatePanel } from '../components/panels'
import { Record, Wordmark } from '../components/Record'
import { Row } from '../components/ui'
import { PhotoBackdrop } from '../components/PhotoBackdrop'
import { BACKDROPS } from '../lib/backgrounds'
import { type Access, type Config, api } from '../lib/api'
import { focusFirst, moveFocus, useRemote } from '../lib/keys'
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
  { id: 'about', label: 'About', icon: Info },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

export function Settings({
  config, onConfig, onBack, onRerunSetup,
}: { config: Config; onConfig: (c: Config) => void; onBack: () => void; onRerunSetup: () => void }) {
  const [section, setSection] = useState<SectionId>(() => (new URLSearchParams(location.search).get('section') as SectionId) || 'audio')
  const [zone, setZone] = useState<'nav' | 'panel'>('nav')
  const nav = useRef<HTMLDivElement>(null)
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
    if (k === 'left') {
      setZone('nav')
      nav.current?.querySelector<HTMLElement>(`[data-section="${section}"]`)?.focus()
      sfx.tick()
      return true
    }
    if (k === 'up' || k === 'down') return moveFocus(panel.current, k === 'down' ? 1 : -1) ? (sfx.tick(), true) : (sfx.edge(), true)
    return false
  })

  return (
    <div className="tv relative flex h-full">
      <PhotoBackdrop index={1} dim={0.86} drift={false} />
      <aside ref={nav} className="relative flex w-[24rem] shrink-0 flex-col gap-2 px-[3vw] pt-[6vh]">
        <h1 className="mb-6 px-2 text-[2.1rem] font-semibold tracking-[-0.02em]">Settings</h1>
        {SECTIONS.map((s) => {
          const active = section === s.id
          return (
            <button
              key={s.id}
              type="button"
              data-section={s.id}
              tabIndex={-1}
              className={`flex items-center gap-4 rounded-[0.9rem] px-4 py-3 text-left text-[1rem] transition-[transform,background-color,color] duration-200 ${
                active && zone === 'nav'
                  ? 'scale-[1.03] bg-white text-[rgb(12_12_14)]'
                  : active
                    ? 'bg-white/12 text-white'
                    : 'text-white/55'
              }`}
            >
              <s.icon className="size-[1.3rem]" strokeWidth={1.75} />
              {s.label}
            </button>
          )
        })}
      </aside>
      <section ref={panel} key={section} className="no-scrollbar mo-fade-in relative flex-1 overflow-y-auto px-[4vw] pt-[14vh] pb-[8vh]">
        <div className="max-w-[44rem]">
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
          {section === 'library' && <LibraryPanel />}
          {section === 'access' && <AccessSection />}
          {section === 'display' && <DisplayPanel config={config} onConfig={onConfig} />}
          {section === 'remote' && <RemoteSection />}
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
      <UpdatePanel />
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
