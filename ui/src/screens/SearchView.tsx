import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Cover } from '../components/Cover'
import { OnScreenKeyboard } from '../components/OnScreenKeyboard'
import { type Album, type SearchResult, type Status, albumKey, api, fmtTime } from '../lib/api'
import { focusFirst, moveSpatial, useRemote } from '../lib/keys'
import { sfx } from '../lib/sounds'
import { ArtistPortrait } from './Home'

/** Keyboard on the left, live results on the right (tvOS search). */
export function SearchView({
  onBack, onOpenAlbum, onOpenArtist, onPlayed,
}: { onBack: () => void; onOpenAlbum: (a: Album) => void; onOpenArtist: (n: string) => void; onPlayed: (s: Status) => void }) {
  const [query, setQuery] = useState(() => sessionStorage.getItem('mo-search') ?? '')
  const [res, setRes] = useState<SearchResult | null>(null)
  const [zone, setZone] = useState<'keys' | 'results'>('keys')
  const results = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sessionStorage.setItem('mo-search', query)
    const t = setTimeout(() => {
      if (query.trim().length < 2) return setRes(null)
      api.search(query).then(setRes).catch(() => setRes(null))
    }, 220)
    return () => clearTimeout(t)
  }, [query])

  const toResults = () => {
    if (!results.current?.querySelector('[data-nav]')) return false
    setZone('results')
    setTimeout(() => focusFirst(results.current), 0)
    sfx.tick()
    return true
  }

  useRemote((k) => {
    if (zone === 'keys') {
      if (k === 'back') return sfx.back(), onBack(), true
      return false // the keyboard handles everything else
    }
    if (k === 'back') {
      setZone('keys')
      ;(document.activeElement as HTMLElement | null)?.blur()
      sfx.back()
      return true
    }
    if (k === 'up' || k === 'down' || k === 'left' || k === 'right') {
      if (moveSpatial(results.current, k)) return sfx.tick(), true
      if (k === 'left') {
        setZone('keys')
        ;(document.activeElement as HTMLElement | null)?.blur()
        sfx.tick()
        return true
      }
      return sfx.edge(), true
    }
    return false
  })

  const empty = res && !res.artists.length && !res.albums.length && !res.tracks.length

  return (
    <div className="tv relative flex h-full">
      <div className="mo-ambient" />
      <aside className="relative flex w-[44vw] shrink-0 flex-col justify-center px-[4vw]">
        <div className="mb-6 flex h-[3.8rem] items-center gap-4 rounded-[1.1rem] bg-white/[0.08] px-5">
          <Search className="size-[1.4rem] text-white/50" strokeWidth={2} />
          <span className="truncate text-[1.5rem] font-medium">
            {query || <span className="font-normal text-white/35">Artists, albums, songs</span>}
          </span>
          {zone === 'keys' && <span className="-ml-3 h-[1.5rem] w-[2px] animate-pulse bg-white/70" />}
        </div>
        <OnScreenKeyboard
          layout="full"
          value={query}
          onChange={setQuery}
          onDone={toResults}
          doneLabel="Results"
          active={zone === 'keys'}
          showFocus={zone === 'keys'}
          onEdge={(d) => (d === 'right' ? toResults() : false)}
        />
      </aside>

      <div ref={results} className="no-scrollbar relative flex-1 overflow-y-auto py-[8vh] pr-[4vw] pl-[1vw]">
        {!res && <div className="flex h-full items-center text-[1.1rem] text-white/40">{query.trim().length < 2 ? 'Start typing to search your library.' : 'Searching…'}</div>}
        {empty && <div className="flex h-full items-center text-[1.1rem] text-white/45">No matches for “{query}”.</div>}

        {!!res?.artists.length && (
          <section className="mb-8">
            <div className="eyebrow mb-4">Artists</div>
            <div className="flex flex-wrap gap-5">
              {res.artists.slice(0, 6).map((a) => (
                <button key={a.artist} type="button" data-nav onClick={() => (sfx.select(), onOpenArtist(a.artist))} className="group flex w-[8.5rem] flex-col items-center gap-2 outline-none">
                  <span className="relative block aspect-square w-full rounded-full transition-transform duration-200 group-focus:scale-[1.08]">
                    <ArtistPortrait entry={a} className="size-full rounded-full" />
                  </span>
                  <span className="w-full truncate text-center text-[0.88rem] text-white/60 group-focus:text-white">{a.artist}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {!!res?.albums.length && (
          <section className="mb-8">
            <div className="eyebrow mb-4">Albums</div>
            <div className="grid grid-cols-4 gap-5">
              {res.albums.slice(0, 12).map((a) => (
                <button key={albumKey(a)} type="button" data-nav onClick={() => (sfx.select(), onOpenAlbum(a))} className="group text-left outline-none">
                  <span className="block rounded-[0.6rem] transition-transform duration-200 group-focus:scale-[1.07] group-focus:shadow-[0_1.4rem_2.6rem_-0.8rem_rgb(0_0_0/0.85)]">
                    <Cover file={a.file} title={a.album} artist={a.artist} fraction={0.1} className="aspect-square w-full rounded-[0.6rem]" />
                  </span>
                  <span className="mt-2 block truncate text-[0.88rem] text-white/70 group-focus:text-white">{a.album}</span>
                  <span className="block truncate text-[0.78rem] text-white/40">{a.artist}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {!!res?.tracks.length && (
          <section>
            <div className="eyebrow mb-3">Songs</div>
            {res.tracks.slice(0, 12).map((t) => (
              <button
                key={t.file}
                type="button"
                data-nav
                onClick={async () => {
                  sfx.select()
                  const albumTracks = await api.tracks({ artist: t.artist, album: t.album, year: '', file: t.file, tracks: 0 })
                  const pos = Math.max(0, albumTracks.findIndex((x) => x.file === t.file))
                  onPlayed(await api.play({ artist: t.artist, album: t.album, year: '', file: t.file, tracks: 0 }, pos))
                }}
                className="flex w-full items-center gap-4 rounded-[0.8rem] px-3 py-2.5 text-left transition-[transform,background-color,color] duration-200 focus:scale-[1.02] focus:bg-white focus:text-[rgb(12_12_14)]"
              >
                <Cover file={t.file} title={t.album} fraction={0.04} className="size-[2.8rem] shrink-0 rounded-[0.45rem]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.98rem] font-medium">{t.title}</span>
                  <span className="block truncate text-[0.8rem] opacity-55">
                    {t.artist} · {t.album}
                  </span>
                </span>
                <span className="text-[0.82rem] tabular-nums opacity-45">{t.duration ? fmtTime(t.duration) : ''}</span>
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
