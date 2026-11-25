import { Button } from '@glyphui/ui'
import { AudioLines, ListEnd, ListStart, Play, Shuffle, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Cover } from '../components/Cover'
import { FormatBadges } from '../components/ui'
import { type Album, type Status, type Track, api, backdropUrl, coverUrl, fmtTime } from '../lib/api'
import { setAccentFrom } from '../lib/color'
import { moveFocus, useRemote } from '../lib/keys'
import { sfx } from '../lib/sounds'

export function AlbumView({
  album, status, onBack, onPlayed, onArtist,
}: { album: Album; status: Status | null; onBack: () => void; onPlayed: (s: Status) => void; onArtist: (name: string) => void }) {
  const [tracks, setTracks] = useState<Track[]>([])
  const [note, setNote] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setAccentFrom(coverUrl(album.file, 0.05))
    api.tracks(album).then(setTracks).catch(() => setTracks([]))
  }, [album])
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [])

  const play = async (pos: number) => {
    sfx.select()
    onPlayed(await api.play(album, pos))
  }
  const enqueue = async (mode: 'next' | 'end') => {
    sfx.select()
    await api.enqueue(album, mode)
    setNote(mode === 'next' ? 'Plays after the current song' : 'Added to the end of the queue')
    setTimeout(() => setNote(''), 2500)
  }

  useRemote((k) => {
    if (k === 'back') return sfx.back(), onBack(), true
    if (k === 'up' || k === 'left') return moveFocus(ref.current, -1) ? (sfx.tick(), true) : (sfx.edge(), true)
    if (k === 'down' || k === 'right') return moveFocus(ref.current, 1) ? (sfx.tick(), true) : (sfx.edge(), true)
    return false
  })

  const total = tracks.reduce((s, t) => s + t.duration, 0)
  const nowFile = status?.state === 'play' || status?.state === 'pause' ? status.song?.file : undefined
  const queueActive = (status?.queueLength ?? 0) > 0

  return (
    <div className="tv relative h-full overflow-hidden">
      <img src={backdropUrl(album.file)} alt="" className="mo-backdrop mo-fade-in opacity-60" />
      <div className="absolute inset-0 bg-gradient-to-r from-[rgb(9_9_11/0.25)] via-[rgb(9_9_11/0.7)] to-[rgb(9_9_11/0.92)]" />

      <div ref={ref} className="relative flex h-full items-center gap-[5vw] px-[6vw]">
        <div className="mo-rise shrink-0" style={{ width: 'min(64vh, 34vw)' }}>
          <Cover file={album.file} title={album.album} artist={album.artist} fraction={0.36} eager className="aspect-square w-full rounded-[1rem] shadow-[0_2.5rem_5rem_-1rem_rgb(0_0_0/0.8)]" />
        </div>

        <div className="mo-rise flex h-[80vh] min-w-0 flex-1 flex-col pt-[3vh]" style={{ animationDelay: '60ms' }}>
          <FormatBadges codec={album.codec} format={album.format} />
          <h1 className="mt-4 line-clamp-2 text-[2.6rem] leading-[1.05] font-semibold tracking-[-0.025em]">{album.album}</h1>
          <button
            type="button"
            data-nav
            onClick={() => (sfx.select(), onArtist(album.artist))}
            className="mt-2 -ml-3 inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-[1.2rem] text-white/80 transition-[transform,background-color,color] duration-200 focus:scale-[1.04] focus:bg-white focus:text-[rgb(12_12_14)]"
          >
            <UserRound className="size-[1.05rem] opacity-70" strokeWidth={2} />
            {album.artist}
          </button>
          <div className="mt-1 text-[0.92rem] text-white/45">
            {[album.year, `${album.tracks} songs`, total ? `${Math.round(total / 60)} min` : ''].filter(Boolean).join(' · ')}
          </div>
          <div className="mt-6 flex items-center gap-3">
            <Button data-nav data-autofocus onClick={() => play(0)}>
              <Play className="fill-current" />
              Play
            </Button>
            <Button data-nav onClick={async () => (sfx.select(), onPlayed(await api.shuffle(album.artist, album.album)))}>
              <Shuffle />
              Shuffle
            </Button>
            {queueActive && (
              <>
                <Button data-nav onClick={() => enqueue('next')}>
                  <ListStart />
                  Play next
                </Button>
                <Button data-nav onClick={() => enqueue('end')}>
                  <ListEnd />
                  Add to queue
                </Button>
              </>
            )}
          </div>
          <div className="mt-2 h-5 text-[0.82rem] text-white/50">{note}</div>

          <div className="no-scrollbar mt-3 -ml-4 flex-1 overflow-y-auto pr-2 pb-8 pl-1">
            {tracks.map((t, i) => {
              const now = nowFile === t.file
              return (
                <button
                  key={t.file}
                  type="button"
                  data-nav
                  onClick={() => play(i)}
                  className="flex w-full items-center gap-5 rounded-[0.8rem] px-4 py-[0.72rem] text-left text-white/85 transition-[transform,background-color,color] duration-200 focus:scale-[1.02] focus:bg-white focus:text-[rgb(12_12_14)]"
                >
                  <span className="w-7 text-right text-[0.88rem] tabular-nums opacity-50">
                    {now ? <AudioLines className="ml-auto size-[1rem] opacity-100" /> : t.track.split('/')[0].replace(/^0/, '') || i + 1}
                  </span>
                  <span className="flex-1 truncate text-[1.02rem]">{t.title}</span>
                  <span className="text-[0.85rem] tabular-nums opacity-45">{t.duration ? fmtTime(t.duration) : ''}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
