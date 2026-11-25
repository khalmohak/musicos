import { Progress } from '@glyphui/ui'
import QRCode from 'qrcode'
import {
  AudioLines, Bell, BellOff, Check, EthernetPort, FolderOpen, Globe, HardDrive, Lock, RefreshCw, Server,
  Speaker, Tv, Usb, Waypoints, Wifi, WifiHigh, WifiLow, WifiOff, WifiZero,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  type Access, type AudioOutput, type Config, type Network, type Source, type Stats, type WifiNetwork, api, fmtBytes,
} from '../lib/api'
import { focusFirst, useRemote } from '../lib/keys'
import { configureSounds, sfx } from '../lib/sounds'
import { OnScreenKeyboard } from './OnScreenKeyboard'
import { Row, Toggle } from './ui'

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {title && <div className="eyebrow mb-1 px-1">{title}</div>}
      {children}
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <div className="min-h-[1.3rem] px-1 text-[0.82rem] text-white/50">{children}</div>
}

// ---------------------------------------------------------------- network
const signalIcon = (s: number) => (s >= 70 ? Wifi : s >= 45 ? WifiHigh : s >= 20 ? WifiLow : WifiZero)

export function NetworkPanel() {
  const [net, setNet] = useState<Network | null>(null)
  const [nets, setNets] = useState<WifiNetwork[] | null>(null)
  const [joining, setJoining] = useState<WifiNetwork | null>(null)
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const refresh = () => api.network().then(setNet).catch(() => {})
  useEffect(() => {
    refresh()
    api.wifiScan().then(setNets).catch(() => setNets([]))
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [])

  const connect = async (n: WifiNetwork, pw: string) => {
    setJoining(null)
    setMsg(`Joining ${n.ssid}…`)
    try {
      await api.wifiConnect(n.ssid, pw)
      setMsg(`Connected to ${n.ssid}.`)
      sfx.select()
      refresh()
      api.wifiScan().then(setNets).catch(() => {})
    } catch (e) {
      setMsg(`Couldn't join ${n.ssid}: ${(e as Error).message}`)
    }
    setPassword('')
    setTimeout(() => focusFirst(ref.current), 50)
  }

  // Back closes the password keyboard instead of leaving the screen
  useRemote((k) => {
    if (joining && k === 'back') {
      sfx.back()
      setJoining(null)
      setPassword('')
      setTimeout(() => focusFirst(ref.current), 50)
      return true
    }
    return false
  }, !!joining)

  if (joining) {
    return (
      <div className="flex flex-col items-center gap-6">
        <div className="text-center">
          <div className="text-[1.15rem] font-medium">Password for “{joining.ssid}”</div>
          <div className="mt-4 flex h-[3.6rem] w-[30rem] items-center justify-center rounded-[1rem] bg-white/[0.07] text-[1.6rem] tracking-[0.25em]">
            {password ? '•'.repeat(password.length - 1) + password.slice(-1) : <span className="text-[1rem] tracking-normal text-white/35">Enter password</span>}
          </div>
        </div>
        <OnScreenKeyboard layout="full" value={password} onChange={setPassword} onDone={() => connect(joining, password)} doneLabel="Join" />
      </div>
    )
  }

  const eth = net?.ethernet
  return (
    <div ref={ref} className="flex flex-col gap-6">
      <Section title="Wired">
        <Row
          icon={EthernetPort}
          title="Ethernet"
          sub={!eth?.present ? 'No port' : eth.connected ? `Connected · ${eth.ip}` : 'Cable not connected'}
          trailing={eth?.connected ? <Check className="size-5" /> : null}
        />
        <Row
          icon={Globe}
          title="Internet"
          sub={net ? (net.internet ? 'Online. Cover art and clock sync work.' : 'Offline. Local music still plays.') : 'Checking…'}
          trailing={net?.internet ? <Check className="size-5" /> : null}
        />
      </Section>
      <Section title="Wi-Fi">
        {nets === null && <Note>Looking for networks…</Note>}
        {nets && !net?.wifi.present && nets.length === 0 && (
          <Row icon={WifiOff} title="No Wi-Fi adapter" sub="Plug in Ethernet, or a supported USB Wi-Fi adapter." />
        )}
        <div className="no-scrollbar flex max-h-[34vh] flex-col gap-2 overflow-y-auto p-1">
          {nets?.map((n) => (
            <Row
              key={n.ssid}
              icon={signalIcon(n.signal)}
              title={n.ssid}
              sub={n.active ? `Connected · ${net?.wifi.ip || ''}` : `${n.signal}% signal`}
              trailing={n.active ? <Check className="size-5" /> : n.secure ? <Lock className="size-4 opacity-60" /> : null}
              onClick={() => {
                if (n.active) return
                sfx.select()
                if (n.secure) setJoining(n)
                else connect(n, '')
              }}
            />
          ))}
        </div>
        <Note>{msg}</Note>
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------- sound
const OUTPUT_ICON: Record<AudioOutput['kind'], typeof Tv> = { default: Speaker, hdmi: Tv, usb: Usb, analog: AudioLines }

export function SoundPanel({ config, onConfig }: { config: Config; onConfig: (c: Config) => void }) {
  const [outputs, setOutputs] = useState<AudioOutput[]>([])
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api.outputs().then(setOutputs).catch(() => setOutputs([]))
  }, [])

  const choose = async (o: AudioOutput) => {
    sfx.select()
    setMsg('Playing a test chime…')
    try {
      onConfig(await api.setOutput(o.id))
      await api.testSound(o.id)
      setMsg(`If you heard a chime, ${o.name} is ready.`)
    } catch (e) {
      setMsg(`Couldn't play on ${o.name}: ${(e as Error).message}`)
    }
  }
  const usingDevice = config.audioDevice !== 'default'

  return (
    <div className="flex flex-col gap-6">
      <Section title="Output">
        {outputs.map((o) => (
          <Row
            key={o.id}
            icon={OUTPUT_ICON[o.kind]}
            title={o.name}
            sub={o.detail}
            autoFocus={o.id === config.audioDevice}
            trailing={o.id === config.audioDevice ? <Check className="size-5" /> : null}
            onClick={() => choose(o)}
          />
        ))}
        <Note>{msg}</Note>
      </Section>
      <Section title="Signal">
        <Row
          icon={Waypoints}
          title="Bit-perfect"
          sub={
            usingDevice
              ? 'Untouched audio straight to your DAC. Set volume on the DAC or amp.'
              : 'Pick a specific output (like your DAC) to enable.'
          }
          disabled={!usingDevice}
          trailing={<Toggle on={config.bitPerfect && usingDevice} />}
          onClick={async () => {
            sfx.select()
            onConfig(await api.setBitPerfect(!config.bitPerfect))
          }}
        />
        <Row
          icon={config.uiSounds ? Bell : BellOff}
          title="Interface sounds"
          sub="Soft ticks while browsing. Always silent while music plays."
          trailing={<Toggle on={config.uiSounds} />}
          onClick={async () => {
            const on = !config.uiSounds
            configureSounds({ enabled: on })
            onConfig(await api.saveConfig({ uiSounds: on }))
            if (on) sfx.select()
          }}
        />
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------- library
const SOURCE_ICON: Record<Source['kind'], typeof Tv> = {
  local: HardDrive, disk: HardDrive, usb: Usb, network: Server, folder: FolderOpen,
}

export function LibraryPanel() {
  const [sources, setSources] = useState<Source[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const [s, st] = await Promise.all([api.sources().catch(() => []), api.stats().catch(() => null)])
      if (!alive) return
      setSources(s)
      setStats(st)
      if (st && !st.updating) setScanning(false)
    }
    tick()
    const t = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const busy = scanning || !!stats?.updating
  return (
    <div className="flex flex-col gap-6">
      <Section title="Sources">
        <div className="no-scrollbar flex max-h-[28vh] flex-col gap-2 overflow-y-auto p-1">
          {sources.map((s) => (
            <Row
              key={s.id}
              icon={SOURCE_ICON[s.kind]}
              title={s.name}
              sub={s.mounted ? (s.total ? `${fmtBytes(s.free)} free of ${fmtBytes(s.total)}` : 'Connected') : 'Waiting for drive'}
              trailing={s.mounted ? <Check className="size-5" /> : null}
            />
          ))}
        </div>
        <Note>USB drives and extra internal drives show up here on their own.</Note>
      </Section>
      <Section title="Library">
        <Row
          icon={(p: { className?: string; strokeWidth?: number }) => <RefreshCw {...p} className={`${p.className} ${busy ? 'mo-spin' : ''}`} />}
          title={busy ? 'Scanning…' : 'Scan for new music'}
          sub={stats ? `${stats.albums.toLocaleString()} albums · ${stats.songs.toLocaleString()} tracks` : '—'}
          onClick={async () => {
            sfx.select()
            setScanning(true)
            await api.rescan().catch(() => {})
          }}
        />
        {busy && <Progress className="px-1" value={null} />}
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------- getting music in
export function AccessCard() {
  const [a, setA] = useState<Access | null>(null)
  const [qr, setQr] = useState('')
  useEffect(() => {
    api.access().then(setA).catch(() => {})
  }, [])
  useEffect(() => {
    if (!a?.remoteUrl) return
    QRCode.toString(a.remoteUrl, { type: 'svg', margin: 0, color: { dark: '#f5f5f5', light: '#00000000' } })
      .then(setQr)
      .catch(() => setQr(''))
  }, [a?.remoteUrl])

  const host = a ? (a.ips[0] ?? a.mdns) : '…'
  return (
    <div className="flex flex-col gap-5 rounded-[1.4rem] bg-white/[0.05] p-7">
      <div>
        <div className="eyebrow">From a computer</div>
        <div className="mt-2 text-[0.92rem] text-white/70">Copy albums over SSH. They appear after a scan.</div>
        <div className="mt-3 rounded-[0.7rem] bg-black/40 px-4 py-3 font-mono text-[0.78rem] leading-relaxed break-all text-white/85">
          scp -r "Album" {a?.user ?? 'music'}@{host}:{a?.dropFolder ?? '/srv/music/local'}/
        </div>
      </div>
      <div className="flex items-center gap-5">
        {qr ? (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generated locally by qrcode
          <div className="size-[7.5rem] shrink-0" dangerouslySetInnerHTML={{ __html: qr }} />
        ) : (
          <div className="size-[7.5rem] shrink-0 rounded-lg bg-white/5" />
        )}
        <div>
          <div className="eyebrow">From your phone</div>
          <div className="mt-2 text-[0.92rem] text-white/70">Scan to add a network share (NAS, Samba, Windows).</div>
        </div>
      </div>
    </div>
  )
}
