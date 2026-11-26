import { BookOpen, Check, Disc3, Ear, Loader2, Users } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { Cover } from '../components/Cover'
import { FadeImage } from '../components/Fade'
import { type Status, backdropUrl } from '../lib/api'
import { useAlbumInfo, useTrackCard } from '../lib/info'
import { useRemote } from '../lib/keys'
import { sfx } from '../lib/sounds'

/** The story of what's playing, from the song outwards: the song, what to listen for, who plays
 * on it and what was going on at the time; then the album's stories, the musicians' other bands
 * (marked when they're in the library), credits and the artist's albums. Opened from an album
 * page (no song playing from it), it starts at the album. */
export function AlbumStory({ artist, album, file, status, onBack }: { artist: string; album: string; file: string; status: Status | null; onBack: () => void }) {
  const playing = status?.song && status.song.artist === artist && status.song.album === album ? status.song : null
  const card = useTrackCard(playing?.artist, playing?.album, playing?.title)
  const info = useAlbumInfo(artist, album)
  const panel = useRef<HTMLDivElement>(null)

  useRemote((k) => {
    if (k === 'back') return sfx.back(), onBack(), true
    if (k === 'up' || k === 'down') {
      const el = panel.current
      if (!el) return true
      const at = el.scrollTop
      el.scrollBy({ top: el.clientHeight * 0.45 * (k === 'down' ? 1 : -1), behavior: 'smooth' })
      if ((k === 'up' && at <= 0) || (k === 'down' && at + el.clientHeight >= el.scrollHeight - 2)) sfx.edge()
      else sfx.tick()
      return true
    }
    return true
  })

  const year = info?.date?.slice(0, 4)
  const disc = info?.discography ?? []
  const here = disc.findIndex((d) => d.album.toLowerCase() === album.toLowerCase())
  const credits = info?.credits ?? {}
  // the line-up on every track once (usual role each); per track only what differs
  const lists = Object.values(credits)
  const usual = new Map<string, string>()
  if (lists.length > 1) {
    for (const n of lists[0].map((p) => p.name).filter((n) => lists.every((ps) => ps.some((x) => x.name === n)))) {
      const roles = new Map<string, number>()
      for (const ps of lists) for (const p of ps) if (p.name === n) roles.set(p.role, (roles.get(p.role) ?? 0) + 1)
      usual.set(n, [...roles.entries()].sort((x, y) => y[1] - x[1])[0][0])
    }
  }
  const common = [...usual.entries()].map(([name, role]) => ({ name, role }))
  const extras = Object.entries(credits)
    .map(([t, ps]) => [t, ps.filter((p) => usual.get(p.name) !== p.role)] as const)
    .filter(([, ps]) => ps.length > 0)
  const sources = [...(card?.sources ?? []), ...(info?.sources ?? [])]
    .map((s) => s.name.replace(/^Wikipedia: .*/, 'Wikipedia'))
    .filter((n, i, a) => a.indexOf(n) === i)

  return (
    <div className="tv relative h-full overflow-hidden">
      <FadeImage src={backdropUrl(file)} className="absolute inset-0 overflow-hidden opacity-40" imgClassName="mo-backdrop" />
      <div className="absolute inset-0 bg-gradient-to-r from-[rgb(9_9_11/0.4)] via-[rgb(9_9_11/0.85)] to-[rgb(9_9_11/0.95)]" />

      <div className="relative flex h-full gap-[5vw] px-[6vw]">
        <div className="flex shrink-0 flex-col justify-center" style={{ width: 'min(52vh, 28vw)' }}>
          <Cover file={file} title={album} artist={artist} fraction={0.3} eager className="aspect-square w-full rounded-[1rem] shadow-[0_2.5rem_5rem_-1rem_rgb(0_0_0/0.8)]" />
          {playing && <div className="mt-6 text-[1.6rem] leading-tight font-semibold">{playing.title}</div>}
          <div className={`${playing ? 'mt-1 text-[1.05rem] text-white/70' : 'mt-6 text-[1.5rem] leading-tight font-semibold'}`}>{album}</div>
          <div className="mt-1 text-[1rem] text-white/60">{artist}</div>
          <div className="mt-1 text-[0.9rem] text-white/40">{[year, info?.label].filter(Boolean).join(' · ')}</div>
        </div>

        <div ref={panel} className="no-scrollbar min-w-0 flex-1 overflow-y-auto py-[9vh] pr-[2vw]">
          <div className="flex max-w-[50rem] flex-col gap-11">
            {/* the song */}
            {playing && (!card || card.status === 'pending') && <Waiting>Getting to know “{playing.title}”…</Waiting>}
            {playing && card?.status === 'ready' && (
              <>
                {card.song && (
                  <Section icon={BookOpen} title="The song">
                    <p className="text-[1.3rem] leading-relaxed text-white/90">{card.song}</p>
                  </Section>
                )}
                {!!card.listenFor?.length && (
                  <Section icon={Ear} title="Listen for">
                    <div className="flex flex-col gap-3">
                      {card.listenFor.map((x) => <Line key={x}>{x}</Line>)}
                    </div>
                  </Section>
                )}
                {!!card.players?.length && (
                  <Section icon={Users} title="Who's playing">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                      {card.players.map((p) => (
                        <div key={p.name} className="min-w-0">
                          <div className="text-[1.02rem] text-white/90">{p.name}</div>
                          <div className="text-[0.88rem] leading-snug text-white/50">{p.plays}</div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}
                {card.moment && (
                  <Section title="The moment">
                    <p className="text-[1.08rem] leading-relaxed text-white/75">{card.moment}</p>
                  </Section>
                )}
              </>
            )}

            {/* the album */}
            {(!info || info.status === 'pending') && !playing && <Waiting>Gathering the album’s story…</Waiting>}
            {info?.status === 'off' && <div className="text-white/55">Notes are off: they need an OpenAI key on the box.</div>}
            {info?.status === 'ready' && (
              <>
                {info.summary && (
                  <Section icon={Disc3} title={playing ? 'The album' : 'About'}>
                    <p className={`${playing ? 'text-[1.1rem] text-white/80' : 'text-[1.3rem] text-white/90'} leading-relaxed`}>{info.summary}</p>
                  </Section>
                )}
                {!!info.stories?.length && (
                  <Section title="Stories">
                    <div className="flex flex-col gap-3">
                      {info.stories.map((s) => <Line key={s.text}>{s.text}</Line>)}
                    </div>
                  </Section>
                )}
                {!!info.connections?.length && (
                  <Section title="Where the players came from">
                    <div className="flex flex-col gap-4">
                      {info.connections.map((c) => (
                        <div key={c.name}>
                          <div className="mb-1.5 text-[1rem] text-white/90">{c.name} <span className="text-white/40">· {c.role}</span></div>
                          <div className="flex flex-wrap gap-2">
                            {c.bands.map((b) => (
                              <span key={b.name} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.85rem] ${b.have ? 'bg-white/[0.14] text-white/90' : 'bg-white/[0.04] text-white/50'}`}>
                                {b.have && <Check className="size-[0.85rem]" />}
                                {b.name}{b.years ? ` ${b.years.replace('-', '–')}` : ''}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 text-[0.8rem] text-white/35">Ticked: in your library</div>
                  </Section>
                )}
                {common.length > 0 && <Section title="On every track"><People list={common} /></Section>}
                {extras.length > 0 && (
                  <Section title={common.length ? 'Also on' : 'Who plays on each track'}>
                    <div className="flex flex-col gap-3">
                      {extras.map(([t, ps]) => (
                        <div key={t}>
                          <div className="mb-0.5 text-[0.95rem] font-medium text-white/85">{t}</div>
                          <div className="text-[0.88rem] leading-relaxed text-white/50">{ps.map((p) => `${p.name} (${p.role})`).join(' · ')}</div>
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
                  </Section>
                )}
              </>
            )}

            {sources.length > 0 && (
              <div className="text-[0.8rem] leading-relaxed text-white/35">
                From {sources.join(', ')}. Written by AI from these sources only.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof BookOpen; children: ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-3 flex items-center gap-2">{Icon && <Icon className="size-[0.95rem]" />} {title}</div>
      {children}
    </div>
  )
}

const Line = ({ children }: { children: ReactNode }) => (
  <div className="border-l-2 border-white/20 pl-4 text-[1.05rem] leading-snug text-white/80">{children}</div>
)

const Waiting = ({ children }: { children: ReactNode }) => (
  <div className="flex items-center gap-3 text-[1.05rem] text-white/55">
    <Loader2 className="mo-spin size-[1.2rem]" /> {children}
  </div>
)

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
