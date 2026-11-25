import { Progress } from '@glyphui/ui'
import QRCode from 'qrcode'
import {
  Airplay, AudioLines, Bell, BellOff, Bluetooth, Download, Info, Radio, RotateCcw, Check, EthernetPort, EyeOff, FolderOpen, Gamepad2, Globe, HardDrive, Headphones,
  ImageDown, Keyboard, Lock, Monitor, MonitorPlay, Moon, RefreshCw, Scan, Server, Smartphone, Speaker, Tv, TvMinimal, Usb,
  Waypoints, Wifi, WifiHigh, WifiLow, WifiOff, WifiZero, ZoomIn,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  type Access, type AudioOutput, type BtDevice, type BtState, type Config, type Connection, type DisplayInfo, type Network,
  type ReceiversInfo, type Source, type Stats, type UpdateStatus, type WifiNetwork, api, fmtBytes,
} from '../lib/api'
import { focusFirst, useRemote } from '../lib/keys'
import { configureSounds, sfx } from '../lib/sounds'
import { OnScreenKeyboard } from './OnScreenKeyboard'
import { Row, Toggle } from './ui'

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      {title && <div className="eyebrow mb-1.5 px-1.5">{title}</div>}
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
const OUTPUT_ICON: Record<AudioOutput['kind'], typeof Tv> = { default: Speaker, hdmi: Tv, usb: Usb, analog: AudioLines, bluetooth: Headphones }

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
    <div className="flex flex-col gap-10">
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
    <div className="flex flex-col gap-10">
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
      {a && !a.remoteUrl ? (
        <div className="flex items-center gap-4 rounded-[0.9rem] bg-black/30 px-4 py-4">
          <WifiOff className="size-[1.6rem] shrink-0 text-white/50" strokeWidth={1.75} />
          <div className="text-[0.88rem] leading-snug text-white/65">
            Not on a network yet. Plug in Ethernet or join Wi-Fi in Settings → Network, and a QR code for your phone appears here.
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-5">
          {qr ? (
            // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generated locally by qrcode
            <div className="size-[7.5rem] shrink-0" dangerouslySetInnerHTML={{ __html: qr }} />
          ) : (
            <div className="size-[7.5rem] shrink-0 rounded-lg bg-white/5" />
          )}
          <div>
            <div className="eyebrow">From your phone</div>
            <div className="mt-2 text-[0.92rem] text-white/70">Scan for a full remote: play, queue, search, add network shares.</div>
            {a?.remoteUrl && <div className="mt-2 font-mono text-[0.75rem] text-white/45">{a.remoteUrl}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Bluetooth
const BT_ICON: Record<BtDevice['kind'], typeof Tv> = {
  controller: Gamepad2, keyboard: Keyboard, audio: Headphones, phone: Smartphone, other: Bluetooth,
}

export function BluetoothPanel() {
  const [bt, setBt] = useState<BtState | null>(null)
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const load = () => api.bluetooth().then(setBt).catch(() => setBt({ available: false, powered: false, devices: [] }))
  useEffect(() => {
    load()
  }, [])
  useEffect(() => {
    if (!scanning) return
    const t = setInterval(load, 2000)
    const stop = setTimeout(() => setScanning(false), 16000)
    return () => {
      clearInterval(t)
      clearTimeout(stop)
    }
  }, [scanning])

  if (bt && !bt.available) {
    return <Row icon={Bluetooth} title="No Bluetooth adapter" sub="Most motherboards with Wi-Fi have one; otherwise any USB Bluetooth dongle works." />
  }
  const pair = async (d: BtDevice) => {
    if (d.paired) {
      if (confirm !== d.mac) return setConfirm(d.mac), sfx.tick()
      setConfirm(null)
      await api.btForget(d.mac).catch(() => {})
      setMsg(`Forgot ${d.name}.`)
      return load()
    }
    sfx.select()
    setBusy(d.mac)
    setMsg(`Pairing ${d.name}… put it in pairing mode if it isn't.`)
    try {
      await api.btPair(d.mac)
      setMsg(`${d.name} is connected.`)
    } catch (e) {
      setMsg(`Couldn't pair ${d.name}: ${(e as Error).message}`)
    }
    setBusy(null)
    load()
  }
  return (
    <div className="flex flex-col gap-10">
      <Section title="Bluetooth">
        <Row
          icon={(p: { className?: string; strokeWidth?: number }) => <RefreshCw {...p} className={`${p.className} ${scanning ? 'mo-spin' : ''}`} />}
          title={scanning ? 'Searching…' : 'Search for devices'}
          sub="Put your controller, headphones or keyboard in pairing mode first."
          onClick={() => {
            sfx.select()
            api.btScan().catch(() => {})
            setScanning(true)
          }}
        />
      </Section>
      <Section title="Devices">
        {bt?.devices.length === 0 && <Note>No devices yet. Search to find nearby ones.</Note>}
        {bt?.devices.map((d) => (
          <Row
            key={d.mac}
            icon={BT_ICON[d.kind]}
            title={d.name}
            sub={busy === d.mac ? 'Pairing…' : confirm === d.mac ? 'Press OK again to forget this device' : d.connected ? 'Connected' : d.paired ? 'Paired · not connected' : 'Select to pair'}
            trailing={d.connected ? <Check className="size-5" /> : null}
            onClick={() => pair(d)}
          />
        ))}
        <Note>{msg}</Note>
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------- time zone
export function TimezonePicker({ onDone }: { onDone?: (zone: string) => void }) {
  const [data, setData] = useState<{ current: string; regions: Record<string, string[]> } | null>(null)
  const [region, setRegion] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    api.timezones().then(setData).catch(() => {})
  }, [])
  useEffect(() => {
    setTimeout(() => focusFirst(ref.current), 30)
  }, [region])
  // Back from the city list returns to regions instead of leaving the screen
  useRemote((k) => {
    if (k === 'back') return sfx.back(), setRegion(null), true
    return false
  }, region !== null)

  const pick = async (zone: string) => {
    sfx.select()
    try {
      await api.setTimezone(zone)
      setData((d) => (d ? { ...d, current: zone } : d))
      setMsg(`Time zone set to ${zone.replace(/_/g, ' ')}.`)
      setRegion(null)
      onDone?.(zone)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  const regions = data ? Object.keys(data.regions).sort() : []
  return (
    <div ref={ref} className="flex flex-col gap-2">
      <div className="eyebrow mb-1 px-1">{region ? region.replace(/_/g, ' ') : 'Time zone'}</div>
      {!region && data?.current && (
        <div className="mb-2 px-1 text-[0.92rem] text-white/60">
          Now: <span className="text-white">{data.current.replace(/_/g, ' ')}</span> · {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </div>
      )}
      <div className="no-scrollbar flex max-h-[52vh] flex-col gap-2 overflow-y-auto p-1">
        {!region &&
          regions.map((r) => (
            <Row
              key={r}
              icon={Globe}
              title={r.replace(/_/g, ' ')}
              sub={data?.current.startsWith(`${r}/`) ? data.current.split('/').slice(1).join('/').replace(/_/g, ' ') : `${data?.regions[r].length} places`}
              autoFocus={data?.current.startsWith(`${r}/`)}
              onClick={() => (sfx.select(), setRegion(r))}
            />
          ))}
        {region &&
          data?.regions[region].map((c) => (
            <Row
              key={c}
              title={c.replace(/_/g, ' ').replace(/\//g, ' · ')}
              autoFocus={data.current === `${region}/${c}`}
              trailing={data.current === `${region}/${c}` ? <Check className="size-5" /> : null}
              onClick={() => pick(`${region}/${c}`)}
            />
          ))}
      </div>
      <Note>{msg}</Note>
    </div>
  )
}

// ---------------------------------------------------------------- display

const pretty = (m: string) => {
  const [res, hz] = m.split('@')
  const [w, h] = res.split('x')
  return { res: `${w} × ${h}`, hz: `${hz} Hz`, tag: Number(w) >= 3840 ? '4K' : Number(h) >= 1440 ? 'QHD' : Number(h) >= 1080 ? 'Full HD' : 'HD' }
}

/** Every mode the display offers, sharpest first; picking one asks "Keep this?" for 15 s. */
function ResolutionPicker({ disp, onPicked, onClose }: { disp: DisplayInfo; onPicked: (c: Config) => void; onClose: () => void }) {
  const out = disp.outputs[0]
  const [current, setCurrent] = useState(out.current)
  const [confirm, setConfirm] = useState<{ prev: string; next: string; left: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const modes = [...out.modes].sort((a, b) => {
    const [ra, ha] = a.split('@')
    const [rb, hb] = b.split('@')
    const pa = ra.split('x').map(Number)
    const pb = rb.split('x').map(Number)
    return pb[0] * pb[1] - pa[0] * pa[1] || Number(hb) - Number(ha)
  })
  useEffect(() => {
    const t = setTimeout(() => focusFirst(ref.current), 40)
    return () => clearTimeout(t)
  }, [confirm === null])
  // countdown: no answer = the TV probably can't show it, go back
  useEffect(() => {
    if (!confirm) return
    if (confirm.left <= 0) {
      api.setDisplay(out.name, confirm.prev).then(onPicked).catch(() => {})
      setCurrent(confirm.prev)
      setConfirm(null)
      return
    }
    const t = setTimeout(() => setConfirm((c) => (c ? { ...c, left: c.left - 1 } : c)), 1000)
    return () => clearTimeout(t)
  }, [confirm])
  useRemote((k) => {
    if (k !== 'back') return false
    sfx.back()
    if (confirm) {
      api.setDisplay(out.name, confirm.prev).then(onPicked).catch(() => {})
      setCurrent(confirm.prev)
      setConfirm(null)
    } else onClose()
    return true
  })

  const pick = async (m: string) => {
    if (m === current) return sfx.edge()
    sfx.select()
    try {
      onPicked(await api.setDisplay(out.name, m))
      setConfirm({ prev: current, next: m, left: 15 })
      setCurrent(m)
    } catch {
      sfx.edge()
    }
  }

  if (confirm) {
    const p = pretty(confirm.next)
    return (
      <div ref={ref} className="flex flex-col gap-3">
        <div className="mb-3">
          <div className="text-[1.5rem] font-semibold">Keep {p.res} at {p.hz}?</div>
          <div className="mt-1 text-[0.95rem] text-white/55">Going back to the previous setting in {confirm.left} s.</div>
        </div>
        <Row icon={Check} title="Keep" autoFocus onClick={() => (sfx.select(), setConfirm(null))} />
        <Row icon={RotateCcw} title="Go back" onClick={() => setConfirm({ ...confirm, left: 0 })} />
      </div>
    )
  }
  return (
    <div ref={ref} className="flex flex-col gap-2.5">
      <div className="eyebrow mb-1.5 px-1.5">Resolution & refresh rate · {out.name}</div>
      {modes.map((m) => {
        const p = pretty(m)
        const isCur = m === current
        const isRec = m === out.recommended
        return (
          <Row
            key={m}
            icon={Monitor}
            title={`${p.res} · ${p.hz}`}
            sub={[p.tag, isRec ? 'Recommended: sharpest at a smooth refresh rate' : Number(m.split('@')[1]) < 50 ? 'Low refresh: motion looks choppy' : ''].filter(Boolean).join(' · ')}
            autoFocus={isCur}
            trailing={isCur ? <Check className="size-5" /> : isRec ? <span className="text-[0.8rem] font-semibold">Recommended</span> : null}
            onClick={() => pick(m)}
          />
        )
      })}
      <Note>{disp.demo ? 'Demo modes (dev machine).' : 'Each change asks you to confirm within 15 seconds.'}</Note>
    </div>
  )
}

const SCALES: [number, string][] = [[0.85, 'Smaller'], [0.92, 'Small'], [1, 'Default'], [1.1, 'Large'], [1.2, 'Larger']]
const SLEEPS = [0, 15, 30, 60, 120]
const SAVERS = [2, 5, 10, 30, 0]
const next = <T,>(list: T[], v: T) => list[(list.indexOf(v) + 1) % list.length]

export function DisplayPanel({ config, onConfig }: { config: Config; onConfig: (c: Config) => void }) {
  const [disp, setDisp] = useState<DisplayInfo | null>(null)
  const [picking, setPicking] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const load = () => api.display().then(setDisp).catch(() => {})
  useEffect(() => {
    load()
  }, [])

  const save = async (c: Partial<Config>) => {
    sfx.select()
    onConfig(await api.saveConfig(c))
  }
  if (picking && disp?.outputs[0]) {
    return (
      <ResolutionPicker
        disp={disp}
        onPicked={(c) => (onConfig(c), load())}
        onClose={() => {
          setPicking(false)
          load()
          setTimeout(() => focusFirst(ref.current), 60)
        }}
      />
    )
  }
  const out = disp?.outputs[0]
  const scale = SCALES.find(([v]) => Math.abs(v - (config.uiScale ?? 1)) < 0.01) ?? SCALES[2]
  const cur = out?.current ? pretty(out.current) : null
  return (
    <div ref={ref} className="flex flex-col gap-10">
      <Section title="Screen">
        {out && (
          <Row
            icon={Monitor}
            title="Resolution & refresh rate"
            sub={out.recommended && out.current !== out.recommended ? `Recommended: ${pretty(out.recommended).res} · ${pretty(out.recommended).hz}` : out.name}
            trailing={cur ? <span className="text-[0.95rem] font-medium tabular-nums">{cur.res} · {cur.hz}</span> : null}
            onClick={() => (sfx.select(), setPicking(true))}
          />
        )}
        <Row icon={ZoomIn} title="Interface size" sub="For sitting closer or further from the TV" trailing={<span className="text-[0.95rem] font-medium">{scale[1]}</span>}
          onClick={() => save({ uiScale: next(SCALES, scale)[0] })} />
        <Row icon={Scan} title="Fit to screen" sub="Use if your TV crops the edges (overscan)" trailing={<span className="text-[0.95rem] font-medium">{config.overscan ? `${config.overscan}%` : 'Off'}</span>}
          onClick={() => save({ overscan: next([0, 1, 2, 3, 4, 5], config.overscan ?? 0) })} />
      </Section>
      <Section title="When idle">
        <Row icon={MonitorPlay} title="Screensaver" sub="What's playing, or a slow photo slideshow with the time. Moves so OLEDs don't burn in." trailing={<span className="text-[0.95rem] font-medium">{config.screensaver ? `${config.screensaver} min` : 'Never'}</span>}
          onClick={() => save({ screensaver: next(SAVERS, config.screensaver ?? 5) })} />
        <Row icon={TvMinimal} title="Turn off TV" sub="When nothing is playing (HDMI-CEC)" trailing={<span className="text-[0.95rem] font-medium">{config.autoSleep ? `after ${config.autoSleep} min` : 'Never'}</span>}
          onClick={() => save({ autoSleep: next(SLEEPS, config.autoSleep ?? 0) })} />
        <Row icon={Moon} title="Also sleep musicos" sub="Wake with the keyboard, controller or power button" trailing={<Toggle on={!!config.sleepSystem} />}
          onClick={() => save({ sleepSystem: !config.sleepSystem })} />
      </Section>
      <Section title="Artwork">
        <Row icon={ImageDown} title="Find missing album covers online" sub="From MusicBrainz / Cover Art Archive, when connected" trailing={<Toggle on={config.onlineArt !== false} />}
          onClick={() => save({ onlineArt: config.onlineArt === false })} />
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------- Wi-Fi extras
type Entry = { label: string; value: string; layout?: 'full' }

/** Saved networks (forget), hidden network, and static IP. */
export function NetworkExtras() {
  const [saved, setSaved] = useState<{ name: string; active: boolean; method: string }[]>([])
  const [conns, setConns] = useState<Connection[]>([])
  const [confirm, setConfirm] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [form, setForm] = useState<{ kind: 'hidden' | 'ip'; conn?: string; fields: Entry[]; at: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const load = () => {
    api.wifiSaved().then(setSaved).catch(() => {})
    api.connections().then(setConns).catch(() => {})
  }
  useEffect(load, [])
  useRemote((k) => {
    if (form && k === 'back') {
      sfx.back()
      setForm(null)
      setTimeout(() => focusFirst(ref.current), 50)
      return true
    }
    return false
  }, !!form)

  if (form) {
    const f = form.fields[form.at]
    const submit = async () => {
      if (form.at < form.fields.length - 1) return setForm({ ...form, at: form.at + 1 })
      setForm(null)
      try {
        if (form.kind === 'hidden') {
          setMsg(`Joining ${form.fields[0].value}…`)
          await api.wifiHidden(form.fields[0].value, form.fields[1].value)
          setMsg(`Connected to ${form.fields[0].value}.`)
        } else {
          const [addr, prefix] = form.fields[0].value.split('/')
          await api.setIpv4({ connection: form.conn!, method: 'manual', address: addr, prefix: Number(prefix || 24), gateway: form.fields[1].value, dns: form.fields[2].value })
          setMsg(`Static address ${form.fields[0].value} set on ${form.conn}.`)
        }
      } catch (e) {
        setMsg((e as Error).message)
      }
      load()
      setTimeout(() => focusFirst(ref.current), 50)
    }
    return (
      <div className="flex flex-col items-center gap-5">
        <div className="text-center">
          <div className="eyebrow">{form.kind === 'hidden' ? 'Hidden network' : `IP address · ${form.conn}`}</div>
          <div className="mt-2 text-[1.1rem] font-medium">{f.label}</div>
          <div className="mt-3 flex h-[3.4rem] w-[30rem] items-center justify-center rounded-[1rem] bg-white/[0.07] font-mono text-[1.35rem]">
            {f.value || <span className="font-sans text-[0.95rem] text-white/35">{f.label}</span>}
          </div>
        </div>
        <OnScreenKeyboard
          key={form.at}
          layout="full"
          value={f.value}
          onChange={(v) => setForm({ ...form, fields: form.fields.map((x, i) => (i === form.at ? { ...x, value: v } : x)) })}
          onDone={submit}
          doneLabel={form.at < form.fields.length - 1 ? 'Next' : form.kind === 'hidden' ? 'Join' : 'Save'}
        />
      </div>
    )
  }

  return (
    <div ref={ref} className="flex flex-col gap-6">
      <Section title="Saved networks">
        {saved.length === 0 && <Note>None yet.</Note>}
        {saved.map((n) => (
          <Row
            key={n.name}
            icon={Wifi}
            title={n.name}
            sub={confirm === n.name ? 'Press OK again to forget this network' : n.active ? 'Connected · OK to forget' : 'OK to forget'}
            trailing={n.active ? <Check className="size-5" /> : null}
            onClick={async () => {
              if (confirm !== n.name) return setConfirm(n.name), sfx.tick()
              setConfirm(null)
              await api.wifiForget(n.name).catch(() => {})
              setMsg(`Forgot ${n.name}.`)
              load()
            }}
          />
        ))}
        <Row icon={EyeOff} title="Join a hidden network" onClick={() => (sfx.select(), setForm({ kind: 'hidden', fields: [{ label: 'Network name', value: '' }, { label: 'Password (empty if open)', value: '' }], at: 0 }))} />
      </Section>
      <Section title="IP address">
        {conns.map((c) => (
          <Row
            key={c.name}
            icon={c.type === 'ethernet' ? EthernetPort : Wifi}
            title={c.name}
            sub={c.method === 'manual' ? 'Static address · OK to switch back to automatic' : 'Automatic (DHCP) · OK to set a static address'}
            onClick={async () => {
              sfx.select()
              if (c.method === 'manual') {
                await api.setIpv4({ connection: c.name, method: 'auto' }).catch((e) => setMsg((e as Error).message))
                setMsg(`${c.name} is back on automatic addressing.`)
                return load()
              }
              setForm({ kind: 'ip', conn: c.name, fields: [{ label: 'Address, e.g. 192.168.1.50/24', value: '' }, { label: 'Router (gateway), e.g. 192.168.1.1', value: '' }, { label: 'DNS server (empty = router)', value: '' }], at: 0 })
            }}
          />
        ))}
        <Note>{msg}</Note>
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------- AirPlay / Spotify Connect
export function ReceiversPanel() {
  const [r, setR] = useState<ReceiversInfo | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const load = () => api.receivers().then(setR).catch(() => {})
  useEffect(() => {
    load()
  }, [])
  useRemote((k) => {
    if (naming !== null && k === 'back') {
      sfx.back()
      setNaming(null)
      setTimeout(() => focusFirst(ref.current), 50)
      return true
    }
    return false
  }, naming !== null)

  if (naming !== null) {
    return (
      <div className="flex flex-col items-center gap-5">
        <div className="text-center">
          <div className="eyebrow">Name on your network</div>
          <div className="mt-3 flex h-[3.4rem] w-[30rem] items-center justify-center rounded-[1rem] bg-white/[0.07] text-[1.4rem] font-medium">
            {naming || <span className="text-[0.95rem] font-normal text-white/35">e.g. Living Room</span>}
          </div>
        </div>
        <OnScreenKeyboard
          layout="name"
          value={naming}
          maxLength={32}
          onChange={setNaming}
          doneLabel="Save"
          onDone={async () => {
            await api.setReceivers({ name: naming.trim() || 'musicos' }).catch(() => {})
            setNaming(null)
            load()
            setTimeout(() => focusFirst(ref.current), 50)
          }}
        />
      </div>
    )
  }
  const toggle = (key: 'airplay' | 'spotify') => async () => {
    if (!r) return
    sfx.select()
    await api.setReceivers({ [key]: !r[key].on }).catch(() => {})
    load()
  }
  return (
    <div ref={ref} className="flex flex-col gap-6">
      <Section title="Play from your phone">
        <Row icon={Airplay} title="AirPlay" sub={r?.airplay.installed === false ? 'Not included in this build' : 'iPhone, iPad and Mac: pick musicos in the AirPlay menu'}
          trailing={<Toggle on={!!r?.airplay.on && r.airplay.installed} />} disabled={r?.airplay.installed === false} onClick={toggle('airplay')} />
        <Row icon={Radio} title="Spotify Connect" sub={r?.spotify.installed === false ? 'Not included in this build yet' : 'In the Spotify app: Devices → musicos. Any Spotify Premium account.'}
          trailing={<Toggle on={!!r?.spotify.on && r.spotify.installed} />} disabled={r?.spotify.installed === false} onClick={toggle('spotify')} />
        <Row icon={Tv} title="Name" sub="What phones show for this box" trailing={<span className="text-[0.95rem] font-medium">{r?.name ?? '…'}</span>}
          onClick={() => (sfx.select(), setNaming(r?.name ?? ''))} />
      </Section>
      <Note>Starting music from a phone pauses what's playing here. Pressing play on musicos hands the speakers back.</Note>
    </div>
  )
}

// ---------------------------------------------------------------- software update
export function UpdatePanel() {
  const [u, setU] = useState<UpdateStatus | null>(null)
  const [msg, setMsg] = useState('')
  const [entering, setEntering] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const load = () => api.update().then(setU).catch(() => {})
  useEffect(() => {
    load()
    const t = setInterval(load, 1500)
    return () => clearInterval(t)
  }, [])
  useRemote((k) => {
    if (entering !== null && k === 'back') {
      sfx.back()
      setEntering(null)
      setTimeout(() => focusFirst(ref.current), 50)
      return true
    }
    return false
  }, entering !== null)

  const check = async (url?: string) => {
    sfx.select()
    setMsg('Checking…')
    try {
      const r = await api.checkUpdate(url)
      setMsg(r.upToDate ? `You're up to date (${r.version}).` : `Downloading ${r.version}…`)
    } catch (e) {
      setMsg((e as Error).message)
    }
    load()
  }
  if (entering !== null) {
    return (
      <div className="flex flex-col items-center gap-5">
        <div className="text-center">
          <div className="eyebrow">Update address</div>
          <div className="mt-3 flex h-[3.4rem] w-[34rem] items-center justify-center rounded-[1rem] bg-white/[0.07] font-mono text-[1.1rem]">
            {entering || <span className="font-sans text-[0.95rem] text-white/35">http://192.168.1.18:8090</span>}
          </div>
        </div>
        <OnScreenKeyboard
          layout="full"
          value={entering}
          onChange={setEntering}
          doneLabel="Check"
          onDone={() => {
            const url = entering.trim()
            setEntering(null)
            setTimeout(() => focusFirst(ref.current), 50)
            if (url) check(url)
          }}
        />
      </div>
    )
  }
  const p = u?.progress
  const pct = p?.total ? Math.round((100 * p.done) / p.total) : 0
  const staged = u?.staged && u.install !== 'installed'
  return (
    <div ref={ref} className="flex flex-col gap-2">
      <div className="eyebrow mb-1 px-1">Software update</div>
      <Row icon={Info} title={`Version ${u?.current ?? '…'}`} sub="Updates install next to this version. If a new version doesn't start, musicos goes back to this one by itself." />
      {u?.install === 'installed' ? (
        <Row icon={RotateCcw} title={`Restart to finish (${u.staged})`} sub="Your music, settings and Wi-Fi stay as they are." onClick={() => (sfx.select(), api.power('reboot'))} />
      ) : u?.install === 'installing' || u?.install === 'queued' ? (
        <Row icon={RefreshCw} title="Installing…" sub="A minute or two. Keep musicos on." />
      ) : staged && p?.state !== 'downloading' ? (
        <Row icon={Download} title={`Install ${u.staged}`} sub="Downloaded and verified" onClick={async () => (sfx.select(), await api.installUpdate().catch((e) => setMsg((e as Error).message)), load())} />
      ) : (
        <Row
          icon={(pp: { className?: string; strokeWidth?: number }) => <RefreshCw {...pp} className={`${pp.className} ${p?.state === 'downloading' ? 'mo-spin' : ''}`} />}
          title={p?.state === 'downloading' ? `Downloading… ${pct}%` : 'Check for updates'}
          sub={u?.url ? `From ${u.url}` : 'Set the address of your update server first'}
          onClick={() => (u?.url ? check() : (sfx.select(), setEntering('http://')))}
        />
      )}
      <Row icon={Server} title="Update address" sub={u?.url || 'Not set'} onClick={() => (sfx.select(), setEntering(u?.url || 'http://'))} />
      {u?.usb.map((x) => (
        <Row key={x.path} icon={Usb} title={`Install ${x.version} from USB`} sub={x.path} onClick={async () => (sfx.select(), await api.updateFromUsb(x.path).catch((e) => setMsg((e as Error).message)), load())} />
      ))}
      <Note>{p?.state === 'failed' ? `Update failed: ${p.error}` : u?.install === 'failed' ? 'Installing failed; this version is untouched. See Diagnostics.' : msg}</Note>
    </div>
  )
}
