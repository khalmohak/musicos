import { useCallback, useEffect, useRef, useState } from 'react'
import { type Album, type AudioOutput, type Config, type Status, albumKey, api } from './lib/api'
import { configureSounds, primeAudio } from './lib/sounds'
import { AlbumView } from './screens/AlbumView'
import { Boot } from './screens/Boot'
import { Home } from './screens/Home'
import { NowPlaying } from './screens/NowPlaying'
import { Settings } from './screens/Settings'
import { Setup } from './screens/Setup'

type Screen = { kind: 'setup' } | { kind: 'home' } | { kind: 'album'; album: Album } | { kind: 'playing' } | { kind: 'settings' }

const MIN_BOOT_MS = 1800

export function App() {
  const [config, setConfig] = useState<Config | null>(null)
  const [albums, setAlbums] = useState<Album[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [screen, setScreen] = useState<Screen | null>(null)
  const [boot, setBoot] = useState<'on' | 'leaving' | 'off'>('on')
  const [outputs, setOutputs] = useState<AudioOutput[]>([])
  const focusKey = useRef<string | null>(null)

  // boot: load everything, keep the record spinning at least MIN_BOOT_MS, then fade
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
          setScreen(c.setupComplete ? { kind: 'home' } : { kind: 'setup' })
          // dev only: ?go=home|setup|playing|album:<index> jumps straight to a screen (screenshots)
          const go = import.meta.env.DEV || new URLSearchParams(location.search).has('debug')
            ? new URLSearchParams(location.search).get('go') : null
          if (go === 'home' || go === 'setup' || go === 'playing' || go === 'settings') setScreen({ kind: go })
          else if (go?.startsWith('album:') && a[Number(go.slice(6))]) setScreen({ kind: 'album', album: a[Number(go.slice(6))] })
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
    const prime = () => primeAudio()
    window.addEventListener('keydown', prime, { once: true })
    return () => window.removeEventListener('keydown', prime)
  }, [])

  // playback state
  useEffect(() => {
    const t = setInterval(() => {
      api.status().then((s) => {
        setStatus(s)
        configureSounds({ musicPlaying: s.state === 'play' })
      }).catch(() => {})
    }, 1000)
    return () => clearInterval(t)
  }, [])

  // refresh the wall when the library changes (scan finished, share mounted)
  useEffect(() => {
    if (screen?.kind !== 'home') return
    const t = setInterval(() => api.albums().then((a) => {
      setAlbums((old) => (old.length === a.length ? old : a))
    }).catch(() => {}), 20000)
    return () => clearInterval(t)
  }, [screen?.kind])

  const transport = useCallback(async (k: 'playpause' | 'next' | 'prev' | 'volup' | 'voldown') => {
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

  return (
    <>
      {config && screen?.kind === 'setup' && (
        <Setup
          config={config}
          onDone={async (c) => {
            setConfig(c)
            setAlbums(await api.albums().catch(() => albums))
            setScreen({ kind: 'home' })
          }}
        />
      )}
      {config && screen?.kind === 'home' && (
        <Home
          albums={albums}
          status={status}
          name={config.name}
          focusKey={focusKey.current}
          onOpen={(album) => {
            focusKey.current = albumKey(album)
            setScreen({ kind: 'album', album })
          }}
          onNowPlaying={() => setScreen({ kind: 'playing' })}
          onSettings={() => setScreen({ kind: 'settings' })}
          onTransport={transport}
        />
      )}
      {screen?.kind === 'album' && (
        <AlbumView
          album={screen.album}
          status={status}
          onBack={() => setScreen({ kind: 'home' })}
          onPlayed={(s) => {
            setStatus(s)
            setScreen({ kind: 'playing' })
          }}
        />
      )}
      {config && screen?.kind === 'playing' && (
        <NowPlaying
          status={status}
          outputName={outputs.find((o) => o.id === config.audioDevice)?.name ?? 'Output'}
          bitPerfect={config.bitPerfect && config.audioDevice !== 'default'}
          onBack={() => setScreen({ kind: 'home' })}
          onTransport={transport}
        />
      )}
      {config && screen?.kind === 'settings' && (
        <Settings
          config={config}
          onConfig={setConfig}
          onBack={() => setScreen({ kind: 'home' })}
          onRerunSetup={() => setScreen({ kind: 'setup' })}
        />
      )}
      {boot !== 'off' && <Boot leaving={boot === 'leaving'} />}
    </>
  )
}
