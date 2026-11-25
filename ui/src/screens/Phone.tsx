import { Button, Field, Input, PasswordInput, Slider, toast } from '@glyphui/ui'
import {
  AudioLines, Library, ListMusic, Pause, Play, Search, Server, Shuffle, SkipBack, SkipForward, Volume1, Volume2,
} from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Cover } from '../components/Cover'
import { Record, Wordmark } from '../components/Record'
import { FormatBadges } from '../components/ui'
import {
  type Album, type QueueItem, type SearchResult, type Source, type Status, albumKey, api, backdropUrl, fmtTime,
} from '../lib/api'

type Tab = 'now' | 'library' | 'queue' | 'shares'
const TABS: { id: Tab; label: string; icon: typeof Play }[] = [
  { id: 'now', label: 'Now Playing', icon: AudioLines },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'queue', label: 'Queue', icon: ListMusic },
  { id: 'shares', label: 'Shares', icon: Server },
]

/** Phone remote, opened from the QR code in Settings: full control without the TV remote. */
export function Phone() {
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || 'now')
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    document.body.style.cursor = 'auto'
    document.body.style.userSelect = 'auto'
    document.documentElement.style.fontSize = '16px'
    const tick = () => api.status().then(setStatus).catch(() => {})
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    history.replaceState(null, '', `#${tab}`)
  }, [tab])

  const ctl = async (fn: () => Promise<Status>) => setStatus(await fn().catch(() => status as Status))

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <header className="flex items-center gap-3 px-5 pt-5 pb-3">
        <Record size="1.8rem" spinning={false} />
        <Wordmark className="text-xs" />
      </header>
      <main className="no-scrollbar flex-1 overflow-y-auto px-5 pb-28">
        {tab === 'now' && <NowTab status={status} ctl={ctl} />}
        {tab === 'library' && <LibraryTab onPlayed={(s) => (setStatus(s), setTab('now'))} />}
        {tab === 'queue' && <QueueTab status={status} onPlayed={setStatus} />}
        {tab === 'shares' && <SharesTab />}
      </main>
      <nav className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-[rgb(14_14_17/0.96)] pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-md justify-around py-2">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`flex flex-col items-center gap-1 px-3 py-1 text-[0.68rem] ${tab === t.id ? 'text-white' : 'text-white/45'}`}>
              <t.icon className="size-5" strokeWidth={1.9} />
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}

function NowTab({ status, ctl }: { status: Status | null; ctl: (fn: () => Promise<Status>) => void }) {
  const song = status?.song
  const [vol, setVol] = useState<number | null>(null)
  if (!song) {
    return (
      <div className="flex flex-col items-center gap-4 pt-20 text-center text-white/55">
        <Record size="7rem" spinning={false} />
        Nothing playing. Pick something in Library.
      </div>
    )
  }
  const playing = status.state === 'play'
  const pct = status.duration ? (100 * status.elapsed) / status.duration : 0
  return (
    <div className="relative">
      <img src={backdropUrl(song.file)} alt="" className="pointer-events-none fixed inset-0 -z-10 size-full scale-125 object-cover opacity-40" />
      <Cover file={song.file} title={song.album} artist={song.artist} fraction={0.9} eager className="mt-2 aspect-square w-full rounded-2xl shadow-2xl" />
      <div className="mt-6">
        <FormatBadges codec={song.codec} format={song.format} />
        <div className="mt-3 text-xl font-semibold">{song.title}</div>
        <div className="text-white/65">{song.artist}</div>
        <div className="text-sm text-white/40">{song.album}</div>
      </div>
      <div className="mt-5 h-1 overflow-hidden rounded-full bg-white/15">
        <div className="h-full bg-white/85" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs tabular-nums text-white/45">
        <span>{fmtTime(status.elapsed)}</span>
        <span>-{fmtTime(status.duration - status.elapsed)}</span>
      </div>
      <div className="mt-5 flex items-center justify-center gap-8">
        <button type="button" onClick={() => ctl(() => api.control('previous'))} className="p-2 active:scale-90">
          <SkipBack className="size-8 fill-current" />
        </button>
        <button type="button" onClick={() => ctl(() => api.control('toggle'))} className="flex size-16 items-center justify-center rounded-full bg-white text-black active:scale-95">
          {playing ? <Pause className="size-7 fill-current" /> : <Play className="ml-1 size-7 fill-current" />}
        </button>
        <button type="button" onClick={() => ctl(() => api.control('next'))} className="p-2 active:scale-90">
          <SkipForward className="size-8 fill-current" />
        </button>
      </div>
      {status.volume >= 0 && (
        <div className="mt-7 flex items-center gap-3 text-white/55">
          <Volume1 className="size-5" />
          <Slider
            className="flex-1"
            min={0}
            max={100}
            value={vol ?? status.volume}
            onValueChange={(v) => setVol(typeof v === 'number' ? v : v[0])}
            onValueCommit={(v) => (ctl(() => api.volume(typeof v === 'number' ? v : v[0])), setVol(null))}
          />
          <Volume2 className="size-5" />
        </div>
      )}
    </div>
  )
}

function LibraryTab({ onPlayed }: { onPlayed: (s: Status) => void }) {
  const [q, setQ] = useState('')
  const [albums, setAlbums] = useState<Album[]>([])
  const [res, setRes] = useState<SearchResult | null>(null)
  useEffect(() => {
    api.albums().then(setAlbums).catch(() => {})
  }, [])
  useEffect(() => {
    const t = setTimeout(() => (q.trim().length >= 2 ? api.search(q).then(setRes).catch(() => {}) : setRes(null)), 220)
    return () => clearTimeout(t)
  }, [q])
  const shown = res ? res.albums : albums
  const play = async (a: Album) => onPlayed(await api.play(a, 0))
  return (
    <div>
      <div className="sticky top-0 z-10 -mx-5 bg-[rgb(9_9_11/0.95)] px-5 pt-1 pb-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40" />
          <Input value={q} onChange={(e: { target: { value: string } }) => setQ(e.target.value)} placeholder="Search your library" className="pl-9" />
        </div>
      </div>
      {res?.tracks.length ? (
        <div className="mb-5">
          <div className="eyebrow mb-2">Songs</div>
          {res.tracks.slice(0, 8).map((t) => (
            <button
              key={t.file}
              type="button"
              className="flex w-full items-center gap-3 rounded-lg py-2 text-left active:bg-white/10"
              onClick={async () => {
                const a = { artist: t.artist, album: t.album, year: '', file: t.file, tracks: 0 }
                const tr = await api.tracks(a)
                onPlayed(await api.play(a, Math.max(0, tr.findIndex((x) => x.file === t.file))))
              }}
            >
              <Cover file={t.file} title={t.album} fraction={0.15} className="size-11 shrink-0 rounded-md" />
              <span className="min-w-0">
                <span className="block truncate text-sm">{t.title}</span>
                <span className="block truncate text-xs text-white/45">{t.artist}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-4">
        {shown.map((a) => (
          <div key={albumKey(a)}>
            <button type="button" onClick={() => play(a)} className="block w-full active:scale-[0.97]">
              <Cover file={a.file} title={a.album} artist={a.artist} fraction={0.45} className="aspect-square w-full rounded-xl" />
            </button>
            <div className="mt-2 flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-sm">{a.album}</span>
                <span className="block truncate text-xs text-white/45">{a.artist}</span>
              </span>
              <button type="button" aria-label="Shuffle" onClick={async () => onPlayed(await api.shuffle(a.artist, a.album))} className="p-1 text-white/50">
                <Shuffle className="size-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function QueueTab({ status, onPlayed }: { status: Status | null; onPlayed: (s: Status) => void }) {
  const [items, setItems] = useState<QueueItem[]>([])
  const cur = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    api.queue().then(setItems).catch(() => {})
  }, [status?.pos, status?.queueLength])
  useEffect(() => {
    cur.current?.scrollIntoView({ block: 'center' })
  }, [items.length])
  if (!items.length) return <div className="pt-20 text-center text-white/50">The queue is empty.</div>
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button size="sm" variant="ghost" onClick={async () => (await api.clearQueue(), setItems([]))}>
          Clear
        </Button>
      </div>
      {items.map((it) => (
        <button
          key={`${it.pos}-${it.file}`}
          ref={it.current ? cur : undefined}
          type="button"
          onClick={async () => onPlayed(await api.playPos(it.pos))}
          className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left active:bg-white/10 ${it.current ? 'bg-white/10' : ''} ${it.pos < (status?.pos ?? -1) ? 'opacity-45' : ''}`}
        >
          <Cover file={it.file} title={it.album} fraction={0.15} className="size-11 shrink-0 rounded-md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{it.title}</span>
            <span className="block truncate text-xs text-white/45">{it.artist}</span>
          </span>
          {it.current ? <AudioLines className="size-4" /> : <span className="text-xs tabular-nums text-white/40">{fmtTime(it.duration)}</span>}
        </button>
      ))}
    </div>
  )
}

function SharesTab() {
  const [sources, setSources] = useState<Source[]>([])
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ name: '', server: '', share: '', path: '', username: '', password: '' })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const refresh = () => api.sources().then(setSources).catch(() => {})
  useEffect(() => {
    refresh()
  }, [])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.addShare(form)
      toast.success('Share added. musicos will scan it.')
      setForm({ name: '', server: '', share: '', path: '', username: '', password: '' })
      setTimeout(refresh, 1500)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <h1 className="text-xl font-semibold">Network shares</h1>
      <p className="mt-1 text-sm text-white/55">A NAS, Samba or Windows share with your music. Mounted read-only.</p>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
        <Field label="Name" description="Shown on the TV, e.g. Homelab">
          <Input value={form.name} onChange={set('name')} placeholder="Homelab" />
        </Field>
        <Field label="Server" required description="Hostname or IP address">
          <Input value={form.server} onChange={set('server')} placeholder="192.168.1.109" required inputMode="url" />
        </Field>
        <Field label="Share" required>
          <Input value={form.share} onChange={set('share')} placeholder="8TB" required />
        </Field>
        <Field label="Folder inside the share" description="Optional">
          <Input value={form.path} onChange={set('path')} placeholder="media/music/library" />
        </Field>
        <Field label="Username" description="Leave empty for guest access">
          <Input value={form.username} onChange={set('username')} autoComplete="username" />
        </Field>
        <Field label="Password">
          <PasswordInput value={form.password} onChange={set('password')} autoComplete="current-password" />
        </Field>
        <Button type="submit" disabled={busy || !form.server || !form.share}>
          {busy ? 'Adding…' : 'Add share'}
        </Button>
      </form>
      {sources.length > 0 && (
        <ul className="mt-8 flex flex-col gap-2">
          {sources.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3 text-sm">
              <span>
                {s.name} <span className="text-white/45">· {s.kind}</span>
              </span>
              {s.kind === 'network' ? (
                <Button size="sm" variant="ghost" onClick={() => api.removeSource(s.id.replace(/^net-/, '')).then(() => setTimeout(refresh, 800))}>
                  Remove
                </Button>
              ) : (
                <span className={s.mounted ? 'text-success-text' : 'text-white/45'}>{s.mounted ? 'Connected' : 'Waiting'}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
