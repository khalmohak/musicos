import { Button } from '@glyphui/ui'
import { Shuffle } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Cover } from '../components/Cover'
import { type Album, type ArtistInfo, type Status, albumKey, api, artistArtUrl, backdropUrl, coverUrl } from '../lib/api'
import { setAccentFrom } from '../lib/color'
import { useRemote } from '../lib/keys'
import { reveal } from '../lib/motion'
import { sfx } from '../lib/sounds'

/** Full-bleed artist page: backdrop photo, logo or name, discography as a row of covers. */
export function ArtistView({
  name, onBack, onOpenAlbum, onPlayed,
}: { name: string; onBack: () => void; onOpenAlbum: (a: Album) => void; onPlayed: (s: Status) => void }) {
  const [info, setInfo] = useState<ArtistInfo | null>(null)
  const [zone, setZone] = useState<'actions' | 'albums'>('albums')
  const [idx, setIdx] = useState(0)
  const [logoOk, setLogoOk] = useState(true)
  const row = useRef<HTMLDivElement>(null)
  const tiles = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    api.artist(name).then((i) => {
      setInfo(i)
      if (i.file) setAccentFrom(coverUrl(i.file, 0.05))
    }).catch(() => setInfo(null))
  }, [name])
  useLayoutEffect(() => {
    if (zone === 'albums') reveal(tiles.current[idx], { inline: 'center' })
  }, [idx, zone])

  const albums = info?.albums ?? []
  useRemote((k) => {
    if (k === 'back') return sfx.back(), onBack(), true
    if (zone === 'actions') {
      if (k === 'down' && albums.length) return setZone('albums'), sfx.tick(), true
      if (k === 'ok') {
        sfx.select()
        api.shuffle(name).then(onPlayed).catch(() => {})
        return true
      }
      return k === 'up' || k === 'left' || k === 'right' ? (sfx.edge(), true) : false
    }
    if (k === 'up') return setZone('actions'), sfx.tick(), true
    if (k === 'left' || k === 'right') {
      const n = Math.max(0, Math.min(albums.length - 1, idx + (k === 'right' ? 1 : -1)))
      setIdx(n === idx ? (sfx.edge(), idx) : (sfx.tick(), n))
      return true
    }
    if (k === 'ok' && albums[idx]) return sfx.select(), onOpenAlbum(albums[idx]), true
    return k === 'down' ? (sfx.edge(), true) : false
  })

  const hero = info?.backdrop
    ? artistArtUrl(info.file, name, 'backdrop', 1)
    : info?.photo
      ? artistArtUrl(info.file, name, 'photo', 0.6)
      : info?.file ? backdropUrl(info.file) : ''

  return (
    <div className="tv relative h-full overflow-hidden">
      {hero && <img src={hero} alt="" className="mo-fade-in absolute inset-0 size-full object-cover object-top opacity-80" />}
      <div className="absolute inset-0 bg-gradient-to-t from-[rgb(9_9_11)] via-[rgb(9_9_11/0.55)] to-[rgb(9_9_11/0.15)]" />
      <div className="absolute inset-0 bg-gradient-to-r from-[rgb(9_9_11/0.75)] via-transparent to-transparent" />

      <div className="relative flex h-full flex-col justify-end px-[5vw] pb-[6vh]">
        <div className="mo-rise">
          {info?.logo && logoOk ? (
            <img
              src={artistArtUrl(info.file, name, 'logo', 0.35)}
              alt={name}
              onError={() => setLogoOk(false)}
              className="max-h-[16vh] max-w-[34vw] object-contain object-left drop-shadow-[0_0.4rem_1.2rem_rgb(0_0_0/0.6)]"
            />
          ) : (
            <h1 className="text-[3.6rem] leading-none font-semibold tracking-[-0.03em]">{name}</h1>
          )}
          <div className="mt-4 text-[1.05rem] text-white/65">
            {albums.length === 1 ? '1 album' : `${albums.length} albums`}
          </div>
          <div className="mt-6">
            <Button
              className={zone === 'actions' ? 'bg-white! text-[rgb(12_12_14)]! scale-[1.06]' : ''}
              tabIndex={-1}
              onMouseEnter={() => setZone('actions')}
              onClick={() => (sfx.select(), api.shuffle(name).then(onPlayed).catch(() => {}))}
            >
              <Shuffle />
              Shuffle {name}
            </Button>
          </div>
        </div>

        <div ref={row} className="no-scrollbar mt-[5vh] -mx-[5vw] flex gap-[1.6vw] overflow-x-auto px-[5vw] py-[2.5vh]">
          {albums.map((a, i) => {
            const on = zone === 'albums' && i === idx
            return (
              <div
                key={albumKey(a)}
                ref={(el) => {
                  tiles.current[i] = el
                }}
                className="w-[13vw] shrink-0 cursor-pointer"
                onClick={() => (sfx.select(), onOpenAlbum(a))}
                onMouseEnter={() => (setZone('albums'), setIdx(i))}
              >
                <div className={`lift relative aspect-square rounded-[0.7rem] ${on ? 'is-focused' : ''}`}>
                  <Cover file={a.file} title={a.album} artist={a.artist} fraction={0.14} eager className="size-full rounded-[0.7rem]" />
                </div>
                <div className={`mt-3 truncate text-[0.92rem] transition-colors ${on ? 'text-white' : 'text-white/60'}`}>{a.album}</div>
                <div className="truncate text-[0.8rem] text-white/40">{a.year}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
