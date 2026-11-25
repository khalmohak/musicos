import { AudioLines, Info, Library, RotateCcw, SquareTerminal, Wifi } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { AccessCard, LibraryPanel, NetworkPanel, SoundPanel } from '../components/panels'
import { Record, Wordmark } from '../components/Record'
import { Row } from '../components/ui'
import { type Access, type Config, api } from '../lib/api'
import { focusFirst, moveFocus, useRemote } from '../lib/keys'
import { sfx } from '../lib/sounds'

const SECTIONS = [
  { id: 'audio', label: 'Audio', icon: AudioLines },
  { id: 'network', label: 'Network', icon: Wifi },
  { id: 'library', label: 'Library & drives', icon: Library },
  { id: 'access', label: 'Copy music in', icon: SquareTerminal },
  { id: 'about', label: 'About', icon: Info },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

export function Settings({
  config, onConfig, onBack, onRerunSetup,
}: { config: Config; onConfig: (c: Config) => void; onBack: () => void; onRerunSetup: () => void }) {
  const [section, setSection] = useState<SectionId>('audio')
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
      <div className="mo-ambient" />
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
          {section === 'network' && <NetworkPanel />}
          {section === 'library' && <LibraryPanel />}
          {section === 'access' && <AccessSection />}
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
          <div className="mt-1 text-[0.85rem] text-white/45">version 0.2 · {a?.hostname ?? ''}</div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Row icon={RotateCcw} title="Run setup again" sub="Name, network, output, music sources" onClick={onRerunSetup} />
      </div>
    </div>
  )
}
