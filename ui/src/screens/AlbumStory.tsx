import { BookOpen, Check, Disc3, Loader2 } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { Cover } from '../components/Cover'
import { FadeImage } from '../components/Fade'
import { type Status, backdropUrl } from '../lib/api'
import { useAlbumInfo } from '../lib/info'
import { useRemote } from '../lib/keys'
import { sfx } from '../lib/sounds'

/** The story of an album: summary, recording, facts, who plays on what, the artist's other
 * albums (marked when they're in the library) and where all of it comes from. */
export function AlbumStory({ artist, album, file, status, onBack }: { artist: string; album: string; file: string; status: Status | null; onBack: () => void }) {
  const info = useAlbumInfo(artist, album)
  const panel = useRef<HTMLDivElement>(null)

  useRemote((k) => {
    if (k === 'back') return sfx.back(), onBack(), true
    if (k === 'up' || k === 'down') {
      const el = panel.current
      if (!el) return true
      const step = el.clientHeight * 0.45 * (k === 'down' ? 1 : -1)
      const at = el.scrollTop
      el.scrollBy({ top: step, behavior: 'smooth' })
      if ((k === 'up' && at <= 0) || (k === 'down' && at + el.clientHeight >= el.scrollHeight - 2)) sfx.edge()
      else sfx.tick()
      return true
    }
    return true
  })

  // the playing track, if it's from this album: its personnel first
  const playing = status?.song && status.song.artist === artist && status.song.album === album ? status.song.title : null
  const credits = info?.credits ?? {}
  const trackKey = playing ? Object.keys(credits).find((t) => t.toLowerCase() === playing.toLowerCase()) : undefined
  const year = info?.date?.slice(0, 4)
  // the line-up on every track is shown once (each with their usual role); a track lists only
  // people who aren't on every track, or someone doing something different there
  const lists = Object.values(credits)
  const usual = new Map<string, string>()
  if (lists.length > 1) {
    const names = lists[0].map((p) => p.name).filter((n) => lists.every((ps) => ps.some((x) => x.name === n)))
    for (const n of names) {
      const roles = new Map<string, number>()
      for (const ps of lists) for (const p of ps) if (p.name === n) roles.set(p.role, (roles.get(p.role) ?? 0) + 1)
      usual.set(n, [...roles.entries()].sort((x, y) => y[1] - x[1])[0][0])
    }
  }
  const common = [...usual.entries()].map(([name, role]) => ({ name, role }))
  const extras = Object.entries(credits)
    .filter(([t]) => t !== trackKey)
    .map(([t, ps]) => [t, ps.filter((p) => usual.get(p.name) !== p.role)] as const)
    .filter(([, ps]) => ps.length > 0)
  const disc = info?.discography ?? []
  const here = disc.findIndex((d) => d.album.toLowerCase() === album.toLowerCase())

  return (
    <div className="tv relative h-full overflow-hidden">
      <FadeImage src={backdropUrl(file)} className="absolute inset-0 overflow-hidden opacity-40" imgClassName="mo-backdrop" />
      <div className="absolute inset-0 bg-gradient-to-r from-[rgb(9_9_11/0.4)] via-[rgb(9_9_11/0.85)] to-[rgb(9_9_11/0.95)]" />

      <div className="relative flex h-full gap-[5vw] px-[6vw]">
        <div className="flex shrink-0 flex-col justify-center" style={{ width: 'min(52vh, 28vw)' }}>
          <Cover file={file} title={album} artist={artist} fraction={0.3} eager className="aspect-square w-full rounded-[1rem] shadow-[0_2.5rem_5rem_-1rem_rgb(0_0_0/0.8)]" />
          <div className="mt-6 text-[1.5rem] leading-tight font-semibold">{album}</div>
          <div className="mt-1 text-[1.05rem] text-white/70">{artist}</div>
          <div className="mt-1 text-[0.9rem] text-white/45">{[year, info?.label].filter(Boolean).join(' · ')}</div>
        </div>

        <div ref={panel} className="no-scrollbar min-w-0 flex-1 overflow-y-auto py-[9vh] pr-[2vw]">
          {(!info || info.status === 'pending') && (
            <div className="flex items-center gap-3 pt-[20vh] text-[1.1rem] text-white/60">
              <Loader2 className="mo-spin size-[1.3rem]" /> Gathering notes on this album…
            </div>
          )}
          {info?.status === 'none' && <Empty>No notes found for this album yet.</Empty>}
          {info?.status === 'off' && <Empty>Album notes are off. They need an OpenAI key on the box.</Empty>}
          {info?.status === 'ready' && (
            <div className="flex max-w-[50rem] flex-col gap-10">
              <div>
                <div className="eyebrow mb-3 flex items-center gap-2"><BookOpen className="size-[0.95rem]" /> About</div>
                <p className="text-[1.35rem] leading-relaxed text-white/90">{info.summary}</p>
                {info.recording && <p className="mt-4 text-[1.02rem] leading-relaxed text-white/60">{info.recording}</p>}
              </div>

              {!!info.facts?.length && (
                <Section title="Facts">
                  <div className="flex flex-col gap-3">
                    {info.facts.map((f) => (
                      <div key={f.text} className="border-l-2 border-white/20 pl-4 text-[1.05rem] leading-snug text-white/80">
                        {f.track && <span className="text-white/45">{f.track} · </span>}
                        {f.text}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {trackKey && <Section title={`Now playing: “${trackKey}”`}><People list={credits[trackKey]} /></Section>}
              {common.length > 0 && <Section title="On every track"><People list={common} /></Section>}
              {!!info.albumCredits?.length && <Section title="Album credits"><People list={info.albumCredits} /></Section>}
              {extras.length > 0 && (
                <Section title={common.length ? 'Also on' : 'Who plays on each track'}>
                  <div className="flex flex-col gap-4">
                    {extras.map(([t, ps]) => (
                      <div key={t}>
                        <div className="mb-1 text-[0.95rem] font-medium text-white/85">{t}</div>
                        <div className="text-[0.9rem] leading-relaxed text-white/55">{ps.map((p) => `${p.name} (${p.role})`).join(' · ')}</div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {disc.length > 1 && (
                <Section title={`${artist}: albums`}>
                  <div className="flex flex-wrap gap-2">
                    {disc.map((d, i) => (
                      <span key={d.album + d.year}
                        className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[0.88rem] ${i === here ? 'bg-white text-[rgb(12_12_14)]' : d.have ? 'bg-white/[0.12] text-white/85' : 'bg-white/[0.04] text-white/45'}`}>
                        {i === here ? <Disc3 className="size-[0.9rem]" /> : d.have ? <Check className="size-[0.9rem]" /> : null}
                        {d.year} · {d.album}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 text-[0.8rem] text-white/35">Ticked: in your library</div>
                </Section>
              )}

              {!!info.sources?.length && (
                <div className="text-[0.8rem] leading-relaxed text-white/35">
                  From {info.sources.map((s) => s.name.replace(/^Wikipedia: .*/, 'Wikipedia')).join(', ')}. Summary and facts condensed by AI from these sources only.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-3">{title}</div>
      {children}
    </div>
  )
}

function People({ list }: { list?: { name: string; role: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-2">
      {(list ?? []).map((p) => (
        <div key={p.name} className="min-w-0">
          <div className="truncate text-[1rem] text-white/85">{p.name}</div>
          <div className="truncate text-[0.85rem] text-white/45">{p.role}</div>
        </div>
      ))}
    </div>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <div className="pt-[20vh] text-[1.1rem] text-white/55">{children}</div>
