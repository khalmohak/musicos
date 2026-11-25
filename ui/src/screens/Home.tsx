import { Button } from '@glyphui/ui'
import { Power, Search, Settings as SettingsIcon, UserRound } from 'lucide-react'
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Cover } from '../components/Cover'
import { NowPlayingBar } from '../components/NowPlayingBar'
import { Record } from '../components/Record'
import { PhotoBackdrop } from '../components/PhotoBackdrop'
import { FormatBadges } from '../components/ui'
import { type Album, type ArtistEntry, type Status, albumKey, artistArtUrl, coverUrl } from '../lib/api'
import { setAccentFrom } from '../lib/color'
import { gridMove, stepTo } from '../lib/grid'
import { useRemote } from '../lib/keys'
import { reveal } from '../lib/motion'
import { sfx } from '../lib/sounds'

export type HomeTab = 'albums' | 'artists'
type Transport = 'playpause' | 'next' | 'prev' | 'volup' | 'voldown'

const ALBUM_COLS = 7
const ARTIST_COLS = 6
const HEADER = ['albums', 'artists', 'search', 'settings', 'power'] as const

function greeting(name: string) {
  const h = new Date().getHours()
  const part = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Late night'
  const first = name.trim().split(' ')[0]
  return first ? `${part}, ${first}` : part
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(t)
  }, [])
  return now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function Home({
  albums, artists, status, name, tab, focus, onTab, onFocus, onOpenAlbum, onOpenArtist, onNowPlaying, onSearch,
  onSettings, onPower, onTransport,
}: {
  albums: Album[]
  artists: ArtistEntry[]
  status: Status | null
  name: string
  tab: HomeTab
  /** remembered focus per tab, so Back returns to the same cover */
  focus: { albums: number; artists: number }
  onTab: (t: HomeTab) => void
  onFocus: (t: HomeTab, i: number) => void
  onOpenAlbum: (a: Album) => void
  onOpenArtist: (artist: string) => void
  onNowPlaying: () => void
  onSearch: () => void
  onSettings: () => void
  onPower: () => void
  onTransport: (k: Transport) => void
}) {
  const [zone, setZone] = useState<'header' | 'grid' | 'bar'>('grid')
  const [hIdx, setHIdx] = useState(0)
  const idx = Math.min(focus[tab], Math.max(0, (tab === 'albums' ? albums.length : artists.length) - 1))
  const tiles = useRef<(HTMLElement | null)[]>([])
  const clock = useClock()
  const playing = !!status?.song || !!status?.receiver
  const cols = tab === 'albums' ? ALBUM_COLS : ARTIST_COLS
  const count = tab === 'albums' ? albums.length : artists.length
  const album = tab === 'albums' ? albums[idx] : undefined
  const artist = tab === 'artists' ? artists[idx] : undefined

  useLayoutEffect(() => {
    if (zone === 'grid') reveal(tiles.current[idx], { block: 'center' })
  }, [idx, zone, tab])

  useEffect(() => {
    const file = album?.file ?? artist?.file
    if (file) setAccentFrom(coverUrl(file, 0.05))
  }, [album, artist])

  const setIdx = (i: number) => onFocus(tab, i)

  useRemote((k) => {
    if (k === 'playpause' || k === 'next' || k === 'prev' || k === 'volup' || k === 'voldown') {
      onTransport(k)
      return true
    }
    if (k === 'menu') {
      if (playing) sfx.select(), onNowPlaying()
      return true
    }
    if (zone === 'header') {
      if (k === 'left' || k === 'right') {
        const n = Math.max(0, Math.min(HEADER.length - 1, hIdx + (k === 'right' ? 1 : -1)))
        setHIdx(stepTo(hIdx, n))
        if (n < 2 && HEADER[n] !== tab) onTab(HEADER[n] as HomeTab)
      } else if (k === 'down') {
        setZone('grid')
        sfx.tick()
      } else if (k === 'ok') {
        sfx.select()
        if (HEADER[hIdx] === 'search') onSearch()
        else if (HEADER[hIdx] === 'settings') onSettings()
        else if (HEADER[hIdx] === 'power') onPower()
        else setZone('grid')
      } else return k !== 'back'
      return true
    }
    if (zone === 'bar') {
      if (k === 'up') setZone('grid'), sfx.tick()
      else if (k === 'ok') sfx.select(), onNowPlaying()
      else return k !== 'back'
      return true
    }
    if (k === 'ok') {
      sfx.select()
      if (album) onOpenAlbum(album)
      else if (artist) onOpenArtist(artist.artist)
      else onSettings() // empty library: the only thing on screen is "Open settings"
      return true
    }
    if (k === 'back') {
      // Back on the wall jumps to the top, like tvOS
      if (idx > 0) setIdx(0), sfx.back()
      return true
    }
    const next = gridMove(k, idx, count, cols)
    if (next === null) return false
    if (next === 'out-up') {
      setHIdx(tab === 'albums' ? 0 : 1)
      setZone('header')
      sfx.tick()
    } else if (next === 'out-down') {
      if (playing) setZone('bar'), sfx.tick()
      else sfx.edge()
    } else if (next === 'out-left') sfx.edge()
    else setIdx(stepTo(idx, next))
    return true
  })

  const empty = count === 0
  const headerClick = (i: number) => {
    sfx.select()
    setHIdx(i)
    if (HEADER[i] === 'search') onSearch()
    else if (HEADER[i] === 'settings') onSettings()
    else if (HEADER[i] === 'power') onPower()
    else onTab(HEADER[i] as HomeTab)
  }
  const pill = (i: number, content: ReactNode, active: boolean) => {
    const focused = zone === 'header' && hIdx === i
    return (
      <span
        key={i}
        onClick={() => headerClick(i)}
        onMouseEnter={() => (setZone('header'), setHIdx(i))}
        className={`flex h-[2.6rem] items-center gap-2 rounded-full px-[1.1rem] text-[0.95rem] font-medium transition-[transform,background-color,color] duration-200 ${
          focused ? 'scale-105 bg-white text-[rgb(12_12_14)]' : active ? 'bg-white/[0.14] text-white' : 'text-white/55'
        }`}
      >
        {content}
      </span>
    )
  }
  const iconBtn = (i: number, Icon: typeof Search) => {
    const focused = zone === 'header' && hIdx === i
    return (
      <span
        key={i}
        onClick={() => headerClick(i)}
        onMouseEnter={() => (setZone('header'), setHIdx(i))}
        className={`flex size-[2.6rem] items-center justify-center rounded-full transition-[transform,background-color,color] duration-200 ${
          focused ? 'scale-110 bg-white text-[rgb(12_12_14)]' : 'bg-white/[0.08] text-white/70'
        }`}
      >
        <Icon className="size-[1.2rem]" strokeWidth={1.9} />
      </span>
    )
  }

  return (
    <div className="tv relative flex h-full flex-col">
      <div className="mo-ambient" />

      <header className="relative z-10 px-[4.5vw] pt-[4vh]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {pill(0, 'Albums', tab === 'albums')}
            {pill(1, 'Artists', tab === 'artists')}
          </div>
          <div className="flex items-center gap-3">
            <span className="mr-3 text-[1.05rem] font-medium tabular-nums text-white/70">{clock}</span>
            {iconBtn(2, Search)}
            {iconBtn(3, SettingsIcon)}
            {iconBtn(4, Power)}
          </div>
        </div>
        <div key={(album ? albumKey(album) : artist?.artist) ?? ''} className="mo-fade-in mt-[3.2vh] min-w-0">
          <div className="eyebrow">{greeting(name)}</div>
          <h1 className="mt-2.5 truncate text-[2.3rem] leading-tight font-semibold tracking-[-0.025em]">
            {album?.album ?? artist?.artist ?? ''}
          </h1>
          <div className="mt-1.5 flex h-[1.6rem] items-center gap-3 text-[1rem] text-white/60">
            {album && (
              <>
                <span className="truncate">
                  {album.artist}
                  {album.year && ` · ${album.year}`}
                </span>
                <FormatBadges codec={album.codec} format={album.format} />
              </>
            )}
            {artist && <span>{artist.albums === 1 ? '1 album' : `${artist.albums} albums`}</span>}
          </div>
        </div>
      </header>

      <div className="no-scrollbar relative flex-1 overflow-y-auto px-[4.5vw] pt-[3.5vh] pb-[18vh]">
        {empty && <PhotoBackdrop index={0} dim={0.62} />}
        {empty && (
          <div className="relative flex flex-col items-center gap-5 pt-[10vh] text-center">
            <Record size="8rem" spinning={false} />
            <div className="text-[1.6rem] font-semibold">No music yet</div>
            <p className="max-w-[30rem] text-white/55">Plug in a drive, add a network share, or copy music in, then scan the library in Settings.</p>
            <Button data-nav tabIndex={-1} className="bg-white! text-[rgb(12_12_14)]! scale-[1.06]" onClick={onSettings}>
              <SettingsIcon />
              Open settings
            </Button>
          </div>
        )}

        {tab === 'albums' && (
          <div className="grid gap-x-[1.7vw] gap-y-[3.2vh]" style={{ gridTemplateColumns: `repeat(${ALBUM_COLS}, minmax(0, 1fr))` }}>
            {albums.map((a, i) => (
              <div
                key={albumKey(a)}
                ref={(el) => {
                  tiles.current[i] = el
                }}
                onClick={() => (sfx.select(), onOpenAlbum(a))}
                onMouseEnter={() => (setZone('grid'), setIdx(i))}
                className={`lift relative aspect-square rounded-[0.75rem] ${zone === 'grid' && i === idx ? 'is-focused' : ''}`}
              >
                <Cover file={a.file} title={a.album} artist={a.artist} fraction={0.12} eager={i < ALBUM_COLS * 3} className="size-full rounded-[0.75rem] text-[0.95rem]" />
              </div>
            ))}
          </div>
        )}

        {tab === 'artists' && (
          <div className="grid gap-x-[2.6vw] gap-y-[4vh]" style={{ gridTemplateColumns: `repeat(${ARTIST_COLS}, minmax(0, 1fr))` }}>
            {artists.map((a, i) => {
              const on = zone === 'grid' && i === idx
              return (
                <div
                  key={a.artist}
                  ref={(el) => {
                    tiles.current[i] = el
                  }}
                  onClick={() => (sfx.select(), onOpenArtist(a.artist))}
                  onMouseEnter={() => (setZone('grid'), setIdx(i))}
                  className="flex flex-col items-center gap-3"
                >
                  <div className={`lift relative aspect-square w-full rounded-full ${on ? 'is-focused' : ''}`}>
                    <ArtistPortrait entry={a} className="size-full rounded-full" eager={i < ARTIST_COLS * 3} />
                  </div>
                  <div className={`w-full truncate text-center text-[0.95rem] transition-colors ${on ? 'text-white' : 'text-white/55'}`}>{a.artist}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[24vh] bg-gradient-to-t from-[rgb(9_9_11)] via-[rgb(9_9_11/0.8)] to-transparent" />
      <div className="absolute right-[4.5vw] bottom-[4.5vh] z-10">
        <div onClick={() => (sfx.select(), onNowPlaying())} onMouseEnter={() => setZone('bar')}>
          <NowPlayingBar status={status} focused={zone === 'bar'} />
        </div>
      </div>
    </div>
  )
}

/** Artist photo from the artist folder, falling back to their first album cover, then an icon. */
export function ArtistPortrait({ entry, className = '', eager }: { entry: { artist: string; file: string; photo?: boolean }; className?: string; eager?: boolean }) {
  const [stage, setStage] = useState<'photo' | 'cover' | 'none'>(entry.photo === false ? 'cover' : 'photo')
  const src = useMemo(
    () => (stage === 'photo' ? artistArtUrl(entry.file, entry.artist, 'photo', 0.14) : coverUrl(entry.file, 0.14)),
    [stage, entry.file, entry.artist],
  )
  return (
    <div className={`overflow-hidden bg-[rgb(30_30_34)] ${className}`}>
      {stage !== 'none' ? (
        <img
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setStage(stage === 'photo' ? 'cover' : 'none')}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <UserRound className="size-1/3 text-white/25" strokeWidth={1.25} />
        </div>
      )}
    </div>
  )
}
