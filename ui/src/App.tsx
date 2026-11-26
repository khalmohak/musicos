import { useCallback, useEffect, useRef, useState } from 'react'
import { type Album, type ArtistEntry, type AudioOutput, type Config, type Status, api } from './lib/api'
import { useRemote } from './lib/keys'
import { configureSounds, primeAudio, sfx } from './lib/sounds'
import { PowerMenu } from './components/PowerMenu'
import { VolumeOsd } from './components/VolumeOsd'
import { AlbumView } from './screens/AlbumView'
import { ArtistView } from './screens/ArtistView'
import { Boot } from './screens/Boot'
import { Home, type HomeTab } from './screens/Home'
import { NowPlaying } from './screens/NowPlaying'
import { QueueView } from './screens/QueueView'
import { Screensaver } from './screens/Screensaver'
import { SearchView } from './screens/SearchView'
import { Settings } from './screens/Settings'
import { SourcesView } from './screens/SourcesView'
import { Setup } from './screens/Setup'

type Screen =
  | { kind: 'setup' }
  | { kind: 'home' }
  | { kind: 'album'; album: Album }
  | { kind: 'artist'; name: string }
  | { kind: 'playing' }
  | { kind: 'queue' }
  | { kind: 'search' }
  | { kind: 'settings' }
  | { kind: 'sources' }

type Transport = 'playpause' | 'next' | 'prev' | 'volup' | 'voldown'
const MIN_BOOT_MS = 1800

export function App() {
  const [config, setConfig] = useState<Config | null>(null)
  const [albums, setAlbums] = useState<Album[]>([])
  const [artists, setArtists] = useState<ArtistEntry[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [outputs, setOutputs] = useState<AudioOutput[]>([])
  const [stack, setStack] = useState<Screen[]>([])
  const [boot, setBoot] = useState<'on' | 'leaving' | 'off'>('on')
  const [homeTab, setHomeTab] = useState<HomeTab>('albums')
  const [homeFocus, setHomeFocus] = useState({ albums: 0, artists: 0 })
  const [idle, setIdle] = useState(() => new URLSearchParams(location.search).has('saver'))
  const lastInput = useRef(Date.now())
  const lastBeat = useRef(0)
  const lastStatus = useRef('')
  const [power, setPower] = useState(() => new URLSearchParams(location.search).has('power'))
  const screen = stack[stack.length - 1]

  // ---- navigation: a stack, so Back always returns to where you were ----
  const push = useCallback((s: Screen) => setStack((st) => [...st, s]), [])
  const pop = useCallback(() => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)), [])
  const goHome = useCallback(() => setStack([{ kind: 'home' }]), [])
  /** open a screen once: if it's already in the stack, go back to it instead of stacking a copy */
  const open = useCallback((s: Screen) => setStack((st) => {
    const i = st.findIndex((x) => x.kind === s.kind && s.kind !== 'album' && s.kind !== 'artist')
    return i >= 0 ? st.slice(0, i + 1) : [...st, s]
  }), [])

  // ---- boot ----
  useEffect(() => {
    const started = Date.now()
    const load = async () => {
      for (;;) {
        try {
          const [c, a, s] = await Promise.all([api.config(), api.albums(), api.status()])
          setConfig(c)
          setAlbums(a)
          setStatus(s)
          configureSounds({ enabled: c.uiSounds, musicPlaying: s.state === 'play' })
          const first: Screen = c.setupComplete ? { kind: 'home' } : { kind: 'setup' }
          // dev only: ?debug&go=home|setup|playing|settings|queue|search|album:<i>|artist:<name>
          const params = new URLSearchParams(location.search)
          const go = import.meta.env.DEV || params.has('debug') ? params.get('go') : null
          const extra: Screen | null =
            go === 'playing' || go === 'settings' || go === 'queue' || go === 'search' || go === 'sources' ? { kind: go }
              : go === 'setup' ? { kind: 'setup' }
                : go?.startsWith('album:') && a[Number(go.slice(6))] ? { kind: 'album', album: a[Number(go.slice(6))] }
                  : go?.startsWith('artist:') ? { kind: 'artist', name: decodeURIComponent(go.slice(7)) }
                    : null
          if (go === 'artists') setHomeTab('artists')
          setStack(extra ? (extra.kind === 'setup' ? [extra] : [{ kind: 'home' }, extra]) : [first])
          break
        } catch {
          await new Promise((r) => setTimeout(r, 1500)) // agent or MPD still starting
        }
      }
      const wait = Math.max(0, MIN_BOOT_MS - (Date.now() - started))
      setTimeout(() => setBoot('leaving'), wait)
      setTimeout(() => setBoot('off'), wait + 800)
    }
    load()
    api.outputs().then(setOutputs).catch(() => {})
    api.artists().then(setArtists).catch(() => {})
    const prime = () => primeAudio()
    window.addEventListener('keydown', prime, { once: true })
    return () => window.removeEventListener('keydown', prime)
  }, [])

  // ---- playback state ----
  useEffect(() => {
    const t = setInterval(() => {
      api.status().then((s) => {
        const sig = JSON.stringify(s)
        if (sig === lastStatus.current) return
        lastStatus.current = sig
        setStatus(s)
        configureSounds({ musicPlaying: s.state === 'play' })
      }).catch(() => {})
    }, 1000)
    return () => clearInterval(t)
  }, [])

  // refresh the library when it changes (scan finished, a drive mounted)
  useEffect(() => {
    if (screen?.kind !== 'home') return
    const t = setInterval(() => {
      api.albums().then((a) => setAlbums((old) => (old.length === a.length ? old : a))).catch(() => {})
      api.artists().then((a) => setArtists((old) => (old.length === a.length ? old : a))).catch(() => {})
    }, 20000)
    return () => clearInterval(t)
  }, [screen?.kind])

  // ---- screensaver: any key wakes it and is swallowed, so waking never triggers an action ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      lastInput.current = Date.now()
      if (Date.now() - lastBeat.current > 30000) {
        lastBeat.current = Date.now()
        api.activity().catch(() => {}) // keeps auto-standby from switching the TV off mid-browse
      }
      if (idle) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setIdle(false)
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [idle])
  useEffect(() => {
    const mins = config?.screensaver ?? 5
    if (!mins || screen?.kind === 'setup') return
    const t = setInterval(() => {
      if (Date.now() - lastInput.current > mins * 60000) setIdle(true)
    }, 5000)
    return () => clearInterval(t)
  }, [config?.screensaver, screen?.kind])

  // ---- global buttons (controller Guide/View/X, remote Home/Setup/Search) ----
  useRemote((k) => {
    if (!screen || screen.kind === 'setup') return false
    if (k === 'home') return sfx.back(), goHome(), true
    if (k === 'settings' && screen.kind !== 'settings') return sfx.select(), open({ kind: 'settings' }), true
    if (k === 'search' && screen.kind !== 'search') return sfx.select(), open({ kind: 'search' }), true
    if (k === 'stop') return api.control('stop').then(setStatus).catch(() => {}), true
    if (k === 'power') return sfx.select(), setPower(true), true
    return false
  })

  // mouse / touchpad: show the cursor while it moves, hover moves focus so keys and pointer agree
  useEffect(() => {
    let t = 0
    const onMove = () => {
      document.body.classList.add('mo-pointer')
      lastInput.current = Date.now()
      window.clearTimeout(t)
      t = window.setTimeout(() => document.body.classList.remove('mo-pointer'), 3000)
    }
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-nav]') as HTMLElement | null
      if (el && document.activeElement !== el) el.focus({ preventScroll: true })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseover', onOver)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseover', onOver)
    }
  }, [])

  // UI size and TV overscan (Settings > Display)
  useEffect(() => {
    const root = document.documentElement
    const scale = config?.uiScale ?? 1
    root.style.fontSize = `max(14px, ${(1.25 * scale).toFixed(3)}vw)`
    const pad = `${config?.overscan ?? 0}vw`
    const app = document.getElementById('root')
    if (app) app.style.padding = config?.overscan ? `${pad} ${pad}` : ''
  }, [config?.uiScale, config?.overscan])

  const transport = useCallback(async (k: Transport) => {
    try {
      let s: Status
      if (k === 'playpause') s = await api.control('toggle')
      else if (k === 'next') s = await api.control('next')
      else if (k === 'prev') s = await api.control('previous')
      else s = await api.volume((status?.volume ?? 50) + (k === 'volup' ? 5 : -5))
      setStatus(s)
    } catch {
      /* nothing queued */
    }
  }, [status?.volume])

  const played = (s: Status) => {
    setStatus(s)
    open({ kind: 'playing' })
  }
  const openAlbum = (album: Album) => push({ kind: 'album', album })
  const openArtist = (name: string) => push({ kind: 'artist', name })

  // Home stays rendered under every other screen: covers stay decoded and the scroll position
  // kept, Back is instant, and a screen opened from Home crossfades over it instead of
  // fading in from black. It is hidden (not unmounted) once the new screen has settled.
  const homeBelow = stack[0]?.kind === 'home'
  const onHome = screen?.kind === 'home'
  const [homeShown, setHomeShown] = useState(true)
  const fromHome = useRef(true)
  const prevKind = useRef(screen?.kind)
  if (prevKind.current !== screen?.kind) {
    fromHome.current = prevKind.current === 'home'
    prevKind.current = screen?.kind
  }
  useEffect(() => {
    if (onHome) return setHomeShown(true)
    const t = setTimeout(() => setHomeShown(false), 480)
    return () => clearTimeout(t)
  }, [onHome])

  const screenKey = screen ? `${screen.kind}:${screen.kind === 'album' ? screen.album.file : screen.kind === 'artist' ? screen.name : ''}` : ''

  return (
    <>
      {config && homeBelow && (
        <div className="fixed inset-0" style={{ visibility: onHome || homeShown ? 'visible' : 'hidden' }} aria-hidden={!onHome}>
        <Home
          albums={albums}
          artists={artists}
          status={status}
          name={config.name}
          tab={homeTab}
          focus={homeFocus}
          onTab={setHomeTab}
          onFocus={(t, i) => setHomeFocus((f) => ({ ...f, [t]: i }))}
          onOpenAlbum={openAlbum}
          onOpenArtist={openArtist}
          onNowPlaying={() => open({ kind: 'playing' })}
          onSearch={() => open({ kind: 'search' })}
          onSettings={() => open({ kind: 'settings' })}
          onSources={() => open({ kind: 'sources' })}
          onPower={() => setPower(true)}
          onTransport={transport}
          active={onHome && !power && !idle}
        />
        </div>
      )}
      {!onHome && (
      <div key={screenKey} className={`fixed inset-0 ${fromHome.current ? 'mo-page' : 'mo-page-swap'}`}>
      {config && screen?.kind === 'setup' && (
        <Setup
          config={config}
          onDone={async (c) => {
            setConfig(c)
            setAlbums(await api.albums().catch(() => albums))
            api.artists().then(setArtists).catch(() => {})
            goHome()
          }}
        />
      )}
      {screen?.kind === 'album' && (
        <AlbumView key={screen.album.file} album={screen.album} status={status} onBack={pop} onPlayed={played} onArtist={openArtist} />
      )}
      {screen?.kind === 'artist' && (
        <ArtistView key={screen.name} name={screen.name} onBack={pop} onOpenAlbum={openAlbum} onPlayed={played} />
      )}
      {config && screen?.kind === 'playing' && (
        <NowPlaying
          status={status}
          outputName={outputs.find((o) => o.id === config.audioDevice)?.name ?? 'Output'}
          bitPerfect={config.bitPerfect && config.audioDevice !== 'default'}
          onBack={pop}
          onTransport={transport}
          onQueue={() => open({ kind: 'queue' })}
        />
      )}
      {screen?.kind === 'queue' && <QueueView status={status} onBack={pop} onPlayed={(s) => (setStatus(s), pop())} />}
      {screen?.kind === 'search' && <SearchView onBack={pop} onOpenAlbum={openAlbum} onOpenArtist={openArtist} onPlayed={played} />}
      {config && screen?.kind === 'settings' && (
        <Settings config={config} onConfig={setConfig} onBack={pop} onRerunSetup={() => setStack([{ kind: 'setup' }])} onSources={() => open({ kind: 'sources' })} />
      )}
      {screen?.kind === 'sources' && <SourcesView onBack={pop} />}
      </div>
      )}
      {power && <PowerMenu onClose={() => setPower(false)} />}
      {screen?.kind !== 'setup' && <VolumeOsd volume={status?.volume} />}
      {idle && <Screensaver status={status} albums={albums} />}
      {boot !== 'off' && <Boot leaving={boot === 'leaving'} />}
    </>
  )
}
