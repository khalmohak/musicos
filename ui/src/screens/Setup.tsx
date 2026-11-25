import { Button } from '@glyphui/ui'
import {
  ArrowRight, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, CircleCheck, Clock, Library, Pause, Speaker,
  UserRound, Wifi,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { OnScreenKeyboard } from '../components/OnScreenKeyboard'
import { AccessCard, LibraryPanel, NetworkPanel, SoundPanel, TimezonePicker } from '../components/panels'
import { Record, Wordmark } from '../components/Record'
import { RemoteIcon } from '../components/icons'
import { PhotoBackdrop } from '../components/PhotoBackdrop'
import { PageDots, StepShell } from '../components/ui'
import { type Config, api } from '../lib/api'
import { focusFirst, moveFocus, useRemote } from '../lib/keys'
import { primeAudio, sfx } from '../lib/sounds'

const STEPS = ['welcome', 'you', 'time', 'network', 'sound', 'music', 'remote', 'ready'] as const
const ICON = 'size-[2.1rem] text-white/85'

export function Setup({ config: initial, onDone }: { config: Config; onDone: (c: Config) => void }) {
  const [step, setStep] = useState(() => Number(new URLSearchParams(location.search).get('step')) || 0)
  const [config, setConfig] = useState(initial)
  const [name, setName] = useState(initial.name)
  const ref = useRef<HTMLDivElement>(null)
  const id = STEPS[step]

  const go = (d: 1 | -1) => {
    setStep((s) => Math.max(0, Math.min(STEPS.length - 1, s + d)))
    d > 0 ? sfx.select() : sfx.back()
  }
  useEffect(() => {
    const t = setTimeout(() => focusFirst(ref.current), 80)
    return () => clearTimeout(t)
  }, [step])

  // generic navigation; the name keyboard and the remote test take keys first
  useRemote((k) => {
    primeAudio()
    if (k === 'back') {
      if (step > 0) go(-1)
      return true
    }
    if (id === 'you' || id === 'remote') return false
    if (k === 'up' || k === 'left') return moveFocus(ref.current, -1) ? (sfx.tick(), true) : (sfx.edge(), true)
    if (k === 'down' || k === 'right') return moveFocus(ref.current, 1) ? (sfx.tick(), true) : (sfx.edge(), true)
    return false
  })

  const finish = async () => {
    const c = await api.saveConfig({ name: name.trim(), setupComplete: true })
    sfx.done()
    onDone(c)
  }

  const nextButton = (label = 'Continue') => (
    <Button data-nav onClick={() => go(1)}>
      {label}
      <ArrowRight />
    </Button>
  )

  return (
    <div className="tv relative flex h-full flex-col">
      <PhotoBackdrop index={step} dim={id === 'welcome' ? 0.55 : 0.8} />
      <header className="relative flex h-[12vh] items-center justify-between px-[5vw]">
        <div className="flex items-center gap-3">
          <Record size="1.9rem" spinning={false} />
          <Wordmark className="text-[0.8rem]" />
        </div>
      </header>

      <main ref={ref} key={step} className="no-scrollbar relative flex min-h-0 flex-1 items-center justify-center px-[6vw]">
        {id === 'welcome' && (
          <div className="mo-rise flex flex-col items-center text-center">
            <Record size="min(30vh, 15rem)" />
            <h1 className="mt-12 text-[2.8rem] font-semibold tracking-[-0.025em]">Welcome to musicos</h1>
            <p className="mt-3 text-[1.1rem] text-white/55">Your records. Your speakers. Nothing in between.</p>
            <div className="mt-10">
              <Button data-nav data-autofocus onClick={() => go(1)}>
                Get started
                <ArrowRight />
              </Button>
            </div>
          </div>
        )}

        {id === 'you' && (
          <StepShell icon={<UserRound className={ICON} strokeWidth={1.5} />} title="What should I call you?" sub="For greetings on the home screen. It stays on this device.">
            <div className="flex flex-col items-center gap-6">
              <div className="flex h-[3.6rem] w-[30rem] items-center justify-center rounded-[1rem] bg-white/[0.07] text-[1.6rem] font-medium">
                {name || <span className="text-[1.1rem] font-normal text-white/35">Your name</span>}
                <span className="ml-0.5 h-[1.6rem] w-[2px] animate-pulse bg-white/70" />
              </div>
              <OnScreenKeyboard value={name} onChange={setName} onDone={() => go(1)} maxLength={24} />
            </div>
          </StepShell>
        )}

        {id === 'time' && (
          <StepShell split actions={nextButton()} icon={<Clock className={ICON} strokeWidth={1.5} />} title="Where are you?" sub="For the clock, greetings and the screensaver. Pick your region, then your city.">
            <TimezonePicker onDone={() => setTimeout(() => go(1), 400)} />
          </StepShell>
        )}

        {id === 'network' && (
          <StepShell split actions={nextButton()} icon={<Wifi className={ICON} strokeWidth={1.5} />} title="Connect to your network" sub="Ethernet is best for streaming lossless from a NAS. Internet is optional: local music always plays.">
            <NetworkPanel />
          </StepShell>
        )}

        {id === 'sound' && (
          <StepShell split actions={nextButton()} icon={<Speaker className={ICON} strokeWidth={1.5} />} title="Choose your output" sub="Pick your DAC for the cleanest signal path. Selecting an output plays a short chime.">
            <SoundPanel config={config} onConfig={setConfig} />
          </StepShell>
        )}

        {id === 'music' && (
          <StepShell split actions={nextButton()} icon={<Library className={ICON} strokeWidth={1.5} />} title="Bring your music" sub="Internal and USB drives are found automatically. You can also copy albums in over the network.">
            <div className="flex flex-col gap-6">
              <LibraryPanel />
              <AccessCard />
            </div>
          </StepShell>
        )}

        {id === 'remote' && <RemoteStep onNext={() => go(1)} />}

        {id === 'ready' && (
          <StepShell icon={<CircleCheck className={ICON} strokeWidth={1.5} />} title={name.trim() ? `You're all set, ${name.trim().split(' ')[0]}.` : "You're all set."} sub="Your albums are on the wall. OK opens an album, OK again plays it.">
            <div className="flex justify-center">
              <Button data-nav data-autofocus onClick={finish}>
                Start listening
                <ArrowRight />
              </Button>
            </div>
          </StepShell>
        )}
      </main>

      <footer className="relative flex h-[10vh] items-center justify-center">
        <PageDots count={STEPS.length} current={step} />
      </footer>
    </div>
  )
}

const REMOTE_KEYS = [
  { k: 'up', icon: ChevronUp, col: 2, row: 1 },
  { k: 'left', icon: ChevronLeft, col: 1, row: 2 },
  { k: 'ok', icon: Circle, col: 2, row: 2 },
  { k: 'right', icon: ChevronRight, col: 3, row: 2 },
  { k: 'down', icon: ChevronDown, col: 2, row: 3 },
  { k: 'playpause', icon: Pause, col: 3, row: 3 },
] as const

function RemoteStep({ onNext }: { onNext: () => void }) {
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const [okCount, setOkCount] = useState(0)
  useRemote((k) => {
    if (k === 'back') return false
    setSeen((s) => new Set(s).add(k))
    sfx.tick()
    if (k === 'ok') {
      if (okCount >= 1) onNext()
      setOkCount((n) => n + 1)
    }
    return true
  })
  const all = REMOTE_KEYS.every((r) => seen.has(r.k))
  return (
    <StepShell
      icon={<RemoteIcon className={ICON} strokeWidth={1.5} />}
      title="Try your remote"
      sub="Press each button. Game controllers, IR and HDMI-CEC remotes and keyboards all work. Bluetooth controllers pair in Settings → Bluetooth. Press OK twice to continue."
    >
      <div className="flex flex-col items-center gap-6">
        <div className="grid grid-cols-3 grid-rows-3 gap-3">
          {REMOTE_KEYS.map((r) => {
            const on = seen.has(r.k)
            return (
              <div
                key={r.k}
                style={{ gridColumn: r.col, gridRow: r.row }}
                className={`flex size-[4.6rem] items-center justify-center rounded-[1.2rem] transition-[transform,background-color,color] duration-200 ${
                  on ? 'bg-white text-[rgb(12_12_14)]' : 'bg-white/[0.07] text-white/40'
                }`}
              >
                <r.icon className="size-[1.6rem]" strokeWidth={r.k === 'ok' ? 2.5 : 2} />
              </div>
            )
          })}
        </div>
        <div className="h-5 text-[0.85rem] text-white/50">{all ? 'Every button works.' : 'Waiting for a button…'}</div>
      </div>
    </StepShell>
  )
}
