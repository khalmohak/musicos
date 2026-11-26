import {
  ArrowLeft, Check, ChevronRight, CircleAlert, CircleCheck, CircleDashed, Folder, FolderPlus, HardDrive, KeyRound, Library, Loader2, Pause, Play,
  Plus, RefreshCw, Search, Server, Tags, Trash2, Usb, User, X,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { OnScreenKeyboard } from '../components/OnScreenKeyboard'
import { ScanCard, useScan } from '../components/ScanCard'
import { Row } from '../components/ui'
import {
  type BrowseResult, type LibSource, type LibraryFolder, type LibraryOverview, type NetLogin, type NetServer, type NetTestStep, api,
} from '../lib/api'
import { focusFirst, moveSpatial, useRemote } from '../lib/keys'
import { reveal } from '../lib/motion'
import { sfx } from '../lib/sounds'

type Icon = typeof Server
const KIND_ICON: Record<string, Icon> = { local: HardDrive, usb: Usb, disk: HardDrive, network: Server }
const n = (x: number) => x.toLocaleString()
const gb = (b: number) => (b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : `${Math.round(b / 1e9)} GB`)
const hours = (s: number) => (s >= 3600 ? `${Math.round(s / 3600).toLocaleString()} h` : `${Math.round(s / 60)} min`)

type Mode =
  | { kind: 'list' }
  | { kind: 'folder'; id: string }
  | { kind: 'add' }
  | { kind: 'drives' }
  | { kind: 'pick'; source: LibSource; path: string }
  | { kind: 'net' }
  | { kind: 'type'; label: string; value: string; secret?: boolean; done: (v: string) => void }

/** Music sources: the library is a list of folders from any drive, this device or a network share. */
export function SourcesView({ onBack, pick }: { onBack: () => void; pick?: string }) {
  const [lib, setLib] = useState<LibraryOverview | null>(null)
  const [modes, setModes] = useState<Mode[]>([{ kind: 'list' }])
  const [msg, setMsg] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const scan = useScan()
  const mode = modes[modes.length - 1]

  const load = () => api.library().then(setLib).catch(() => {})
  // opened from the new-drive dialog: go straight to that drive's folders
  const picked = useRef(false)
  useEffect(() => {
    const s = pick && lib?.sources.find((x) => x.id === pick)
    if (s && !picked.current) {
      picked.current = true
      setModes([{ kind: 'list' }, { kind: 'pick', source: s, path: '' }])
    }
  }, [pick, lib])
  useEffect(() => {
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    setMsg('')
    setTimeout(() => focusFirst(panel.current), 60)
  }, [modes.length, mode.kind])

  const push = (m: Mode) => (sfx.select(), setModes((s) => [...s, m]))
  const pop = () => {
    sfx.back()
    if (modes.length > 1) setModes((s) => s.slice(0, -1))
    else onBack()
  }
  const replace = (m: Mode) => setModes((s) => [...s.slice(0, -1), m])
  const toList = () => setModes([{ kind: 'list' }])

  useRemote((k) => {
    if (mode.kind === 'type') return false // the keyboard handles keys
    if (k === 'back') return pop(), true
    if (k === 'up' || k === 'down' || k === 'left' || k === 'right') {
      const moved = moveSpatial(panel.current, k)
      if (moved) reveal(document.activeElement as HTMLElement)
      return moved ? (sfx.tick(), true) : (sfx.edge(), true)
    }
    return false
  })

  const folders = lib?.folders ?? []
  const totals = folders.reduce((a, f) => ({ albums: a.albums + f.albums, tracks: a.tracks + f.tracks, seconds: a.seconds + f.seconds }), { albums: 0, tracks: 0, seconds: 0 })

  return (
    <div className="tv relative flex h-full">
      <div className="mo-ambient" />
      <aside className="relative flex w-[30vw] shrink-0 flex-col justify-center px-[5vw]">
        <div className="mb-7 flex size-[4.6rem] items-center justify-center rounded-[1.3rem] bg-white/[0.07]">
          <Library className="size-[2.1rem] text-white/85" strokeWidth={1.5} />
        </div>
        <h1 className="text-[2.5rem] leading-[1.1] font-semibold tracking-[-0.025em]">Music sources</h1>
        <p className="mt-3 text-[1rem] leading-relaxed text-white/55">
          Your library is built from the folders you choose, on any drive, this device or a network share.
        </p>
        {lib && (
          <div className="mt-8 flex flex-col gap-1.5 text-[0.95rem] tabular-nums text-white/70">
            <span>{n(totals.albums)} albums · {n(totals.tracks)} tracks</span>
            <span className="text-white/45">{hours(totals.seconds)} of music in {folders.length} {folders.length === 1 ? 'folder' : 'folders'}</span>
          </div>
        )}
      </aside>

      <section ref={panel} className="no-scrollbar relative flex-1 overflow-y-auto pt-[8vh] pr-[6vw] pb-[12vh] pl-[2vw]">
        <div className="flex max-w-[52rem] flex-col gap-3">
          {mode.kind === 'list' && <ListMode lib={lib} scan={scan} onOpen={(id) => push({ kind: 'folder', id })} onAdd={() => push({ kind: 'add' })}
            onPick={(source) => push({ kind: 'pick', source, path: '' })} reload={load} setMsg={setMsg} />}
          {mode.kind === 'folder' && <FolderMode f={folders.find((f) => f.id === mode.id)} lib={lib} back={toList} reload={load} setMsg={setMsg} />}
          {mode.kind === 'add' && (
            <>
              <Title>Add music</Title>
              <Row icon={Server} title="Network share" sub="A NAS, a computer or a server sharing a folder (SMB or NFS)" onClick={() => replace({ kind: 'net' })} />
              <Row icon={Usb} title="A drive" sub={`${(lib?.sources ?? []).filter((s) => s.online && (s.kind === 'usb' || s.kind === 'disk')).length} connected · USB drives and disks in this computer`} onClick={() => push({ kind: 'drives' })} />
              <Row icon={HardDrive} title="This device" sub="Music copied onto musicos (over SSH)" onClick={() => {
                const s = lib?.sources.find((x) => x.id === 'local')
                if (s) push({ kind: 'pick', source: s, path: '' })
              }} />
            </>
          )}
          {mode.kind === 'drives' && (
            <>
              <Title>Choose a drive</Title>
              {(lib?.sources ?? []).filter((s) => s.online && (s.kind === 'usb' || s.kind === 'disk')).map((s) => (
                <Row key={s.id} icon={KIND_ICON[s.kind]} title={s.name} sub={s.kind === 'usb' ? 'USB drive' : 'Drive in this computer'}
                  trailing={<ChevronRight className="size-5 opacity-50" />} onClick={() => push({ kind: 'pick', source: s, path: '' })} />
              ))}
              {lib && !lib.sources.some((s) => s.online && (s.kind === 'usb' || s.kind === 'disk')) && (
                <Empty>No drives connected. Plug one in: it appears here within a few seconds.</Empty>
              )}
            </>
          )}
          {mode.kind === 'pick' && (
            <Picker source={mode.source} path={mode.path} onEnter={(p) => push({ kind: 'pick', source: mode.source, path: p })} reload={load} setMsg={setMsg} />
          )}
          {/* the wizard stays mounted while its keyboard is open, or what you type is lost */}
          {modes.some((m) => m.kind === 'net') && (
            <div className={mode.kind === 'net' ? 'contents' : 'hidden'}>
              <NetWizard
                active={mode.kind === 'net'}
                type={(m) => push({ kind: 'type', ...m })}
                onAdded={(source) => setModes([{ kind: 'list' }, { kind: 'pick', source, path: '' }])}
                setMsg={setMsg}
              />
            </div>
          )}
          {mode.kind === 'type' && (
            <div className="flex flex-col items-center gap-5 pt-[4vh]">
              <div className="text-center">
                <div className="eyebrow">{mode.label}</div>
                <div className="mt-3 flex h-[3.4rem] w-[34rem] items-center justify-center rounded-[1rem] bg-white/[0.07] font-mono text-[1.1rem]">
                  {mode.secret ? '•'.repeat(mode.value.length) : mode.value}
                </div>
              </div>
              <OnScreenKeyboard layout="full" value={mode.value} onChange={(v) => replace({ ...mode, value: v })} doneLabel="Done"
                onDone={() => {
                  const { done, value } = mode
                  setModes((s) => s.slice(0, -1))
                  done(value)
                }} />
            </div>
          )}
          <div className="min-h-[1.4rem] px-1 text-[0.9rem] text-white/60">{msg}</div>
        </div>
      </section>
    </div>
  )
}

function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-3 px-1">
      <h2 className="text-[2rem] font-semibold tracking-[-0.02em] text-white/90">{children}</h2>
      {sub && <div className="mt-1.5 text-[0.95rem] text-white/50">{sub}</div>}
    </div>
  )
}
const Empty = ({ children }: { children: ReactNode }) => <div className="rounded-[1rem] bg-white/[0.04] px-6 py-5 text-[0.95rem] text-white/55">{children}</div>

// ---------------------------------------------------------------- list
function ListMode({ lib, scan, onOpen, onAdd, onPick, reload, setMsg }: {
  lib: LibraryOverview | null
  scan: ReturnType<typeof useScan>
  onOpen: (id: string) => void
  onAdd: () => void
  onPick: (s: LibSource) => void
  reload: () => void
  setMsg: (m: string) => void
}) {
  if (!lib) return <Empty>Loading…</Empty>
  const groups = new Map<string, LibraryFolder[]>()
  for (const f of lib.folders) groups.set(f.source, [...(groups.get(f.source) ?? []), f])
  return (
    <>
      {lib.newDrives.map((d) => (
        <div key={d.id} className="mb-2 flex flex-col gap-2 rounded-[1.2rem] bg-white/[0.08] p-3">
          <div className="flex items-center gap-3 px-3 pt-2 text-[1.05rem] font-medium">
            <Usb className="size-[1.3rem]" strokeWidth={1.75} /> New drive: {d.name}{d.size ? ` · ${gb(d.size)}` : ''}
          </div>
          <div className="px-3 pb-1 text-[0.88rem] text-white/50">Add it to your library?</div>
          <Row icon={FolderPlus} title="Choose folders" sub="Pick the folders your music is in" onClick={() => {
            const s = lib.sources.find((x) => x.id === d.id)
            if (s) onPick(s)
          }} />
          <Row icon={Plus} title="Add the whole drive" onClick={async () => {
            sfx.select()
            await api.libraryAdd(d.id, '').then(() => setMsg(`${d.name} added: scanning it now`)).catch((e) => setMsg((e as Error).message))
            reload()
          }} />
          <Row icon={X} title="Not music" sub="Don't ask again for this drive" onClick={async () => (sfx.back(), await api.libraryIgnore(d.id).catch(() => {}), reload())} />
        </div>
      ))}

      <Row icon={Plus} title="Add music" sub="A folder on a drive, this device or a network share" onClick={onAdd} />

      {[...groups.entries()].map(([sid, fs]) => {
        const src = lib.sources.find((s) => s.id === sid)
        const kind = src?.kind ?? fs[0].sourceKind
        const online = src?.online ?? false
        return (
          <div key={sid} className="mt-5 flex flex-col gap-2">
            <div className="flex items-center gap-3 px-1.5">
              <span className="eyebrow">{src?.name ?? fs[0].sourceName}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-[0.72rem] font-medium ${online ? 'bg-white/10 text-white/70' : 'bg-white/[0.04] text-white/40'}`}>
                {kind === 'network' ? (online ? 'Connected' : 'Not reachable') : online ? 'Connected' : 'Not connected'}
              </span>
            </div>
            {fs.map((f) => (
              <Row key={f.id} icon={f.path ? Folder : KIND_ICON[kind]} title={f.path ? f.name : kind === 'local' ? 'Music on this device' : kind === 'network' ? 'Whole share' : 'Whole drive'}
                sub={!f.enabled ? 'Paused: hidden from your library'
                  : !f.online ? `Not connected · ${n(f.albums)} albums shown greyed out`
                    : `${n(f.albums)} albums · ${n(f.tracks)} tracks${f.path ? ` · /${f.path}` : ''}`}
                trailing={!f.enabled ? <Pause className="size-5 opacity-50" /> : !f.online ? <CircleDashed className="size-5 opacity-40" /> : <ChevronRight className="size-5 opacity-40" />}
                onClick={() => onOpen(f.id)} />
            ))}
          </div>
        )
      })}
      {lib.folders.length === 0 && <Empty>No folders yet. Add music to build your library.</Empty>}

      <div className="mt-6 flex flex-col gap-2">
        <div className="eyebrow mb-1 px-1.5">Scanning</div>
        <ScanCard s={scan} />
        <Row icon={RefreshCw} title="Scan everything connected" sub="Finds new and changed files in every connected folder" onClick={async () => {
          sfx.select()
          await api.rescan().catch(() => {})
        }} />
      </div>
    </>
  )
}

// ---------------------------------------------------------------- one folder
function FolderMode({ f, lib, back, reload, setMsg }: { f?: LibraryFolder; lib: LibraryOverview | null; back: () => void; reload: () => void; setMsg: (m: string) => void }) {
  const [sure, setSure] = useState<'' | 'folder' | 'share'>('')
  if (!f) return <Empty>That folder is gone.</Empty>
  const src = lib?.sources.find((s) => s.id === f.source)
  const shareFolders = lib?.folders.filter((x) => x.source === f.source) ?? []
  const act = async (p: Promise<unknown>, done: string) => {
    sfx.select()
    try {
      await p
      setMsg(done)
    } catch (e) {
      setMsg((e as Error).message)
    }
    reload()
  }
  return (
    <>
      <Title sub={`${f.sourceName}${f.path ? ` · /${f.path}` : ' · whole drive'}`}>{f.path ? f.name : f.sourceName}</Title>
      <div className="mb-3 grid grid-cols-3 gap-3">
        {[[n(f.albums), 'albums'], [n(f.tracks), 'tracks'], [hours(f.seconds), 'of music']].map(([v, l]) => (
          <div key={l} className="rounded-[1rem] bg-white/[0.05] px-5 py-4">
            <div className="text-[1.6rem] font-semibold tabular-nums">{v}</div>
            <div className="text-[0.85rem] text-white/45">{l}</div>
          </div>
        ))}
      </div>
      {!f.online && <Empty>{src?.kind === 'network' ? 'The share is not reachable right now.' : 'This drive is not connected.'} Its albums stay in your library, greyed out, and come back when it does.</Empty>}
      <Row icon={RefreshCw} title="Scan this folder" sub="New and changed files" disabled={!f.online}
        onClick={f.online ? () => act(api.libraryScan(f.id), 'Scanning…') : undefined} />
      <Row icon={Tags} title="Re-read all tags here" sub="After editing tags or cover art" disabled={!f.online}
        onClick={f.online ? () => act(api.libraryScan(f.id, true), 'Re-reading tags…') : undefined} />
      <Row icon={f.enabled ? Pause : Play} title={f.enabled ? 'Pause' : 'Resume'} sub={f.enabled ? 'Hide its albums without deleting anything' : 'Show its albums again'}
        onClick={() => act(api.libraryEnable(f.id, !f.enabled), f.enabled ? 'Paused' : 'Resumed')} />
      <Row icon={Trash2} title={sure === 'folder' ? 'Press again to remove' : 'Remove from library'} sub="The files stay where they are"
        onClick={() => {
          if (sure !== 'folder') return sfx.select(), setSure('folder')
          act(api.libraryRemove(f.id), 'Removed').then(back)
        }} />
      {src?.kind === 'network' && (
        <Row icon={Server} title={sure === 'share' ? 'Press again to forget the share' : 'Forget this network share'}
          sub={`Removes ${shareFolders.length} ${shareFolders.length === 1 ? 'folder' : 'folders'} and the saved login`}
          onClick={async () => {
            if (sure !== 'share') return sfx.select(), setSure('share')
            for (const x of shareFolders) await api.libraryRemove(x.id).catch(() => {})
            await act(api.removeSource(f.source.slice(4)), 'Share forgotten')
            back()
          }} />
      )}
    </>
  )
}

// ---------------------------------------------------------------- folder picker
function Picker({ source, path, onEnter, reload, setMsg }: { source: LibSource; path: string; onEnter: (p: string) => void; reload: () => void; setMsg: (m: string) => void }) {
  const [b, setB] = useState<BrowseResult | null>(null)
  const [err, setErr] = useState('')
  const [added, setAdded] = useState<string[]>([])
  useEffect(() => {
    api.libraryBrowse(source.id, path).then(setB).catch((e) => setErr((e as Error).message))
  }, [source.id, path])
  const inLib = (p: string) => [...(b?.included ?? []), ...added].some((x) => x === '' || p === x || p.startsWith(x + '/'))
  const here = path ? path.split('/').pop() : source.name
  const add = async (p: string) => {
    sfx.select()
    try {
      await api.libraryAdd(source.id, p)
      setAdded((a) => [...a, p])
      setMsg(`Added ${p ? p.split('/').pop() : source.name}: scanning it now. Add more, or press Back when done.`)
      reload()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  const total = (b?.folders.reduce((s, f) => s + f.audio, 0) ?? 0) + (b?.audioHere ?? 0)
  return (
    <>
      <Title sub={`${source.name}${path ? ' / ' + path.split('/').join(' / ') : ''}`}>{path ? here : 'Choose folders'}</Title>
      {err && <Empty>{err}</Empty>}
      {!b && !err && <Empty>Reading folders…</Empty>}
      {b && (
        inLib(path) ? (
          <Row icon={CircleCheck} title="In your library" sub={path ? 'This folder is part of your library' : 'The whole source is part of your library'} />
        ) : (
          <Row icon={FolderPlus} title={path ? `Add "${here}"` : `Add all of ${source.name}`}
            sub={total ? `${n(total)}${b.folders.some((f) => !f.complete) ? '+' : ''} audio files, everything inside included` : 'No audio files found in a quick look'}
            onClick={() => add(path)} />
        )
      )}
      {b && b.folders.length > 0 && <div className="eyebrow mt-4 mb-1 px-1.5">Folders</div>}
      {b?.folders.map((f) => (
        <Row key={f.path} icon={inLib(f.path) ? Check : Folder} title={f.name}
          sub={inLib(f.path) ? 'In your library' : f.audio ? `${n(f.audio)}${f.complete ? '' : '+'} audio files` : 'No audio files'}
          trailing={<ChevronRight className="size-5 opacity-40" />}
          onClick={() => onEnter(f.path)} />
      ))}
      {b && b.folders.length === 0 && <Empty>No folders inside.</Empty>}
    </>
  )
}

// ---------------------------------------------------------------- network share wizard
type NetStep = 'server' | 'login' | 'share' | 'test' | 'adding'

function NetWizard({ active, type, onAdded, setMsg }: {
  active: boolean
  type: (m: { label: string; value: string; secret?: boolean; done: (v: string) => void }) => void
  onAdded: (s: LibSource) => void
  setMsg: (m: string) => void
}) {
  const [step, setStep] = useState<NetStep>('server')
  const [servers, setServers] = useState<NetServer[] | null>(null)
  const [login, setLogin] = useState<NetLogin>({ protocol: 'smb', server: '', username: '', password: '' })
  const [shares, setShares] = useState<{ name: string; comment: string }[] | null>(null)
  const [shareErr, setShareErr] = useState('')
  const [test, setTest] = useState<{ ok: boolean; steps: NetTestStep[] } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.netDiscover().then(setServers).catch(() => setServers([]))
  }, [])
  useEffect(() => {
    if (active) setTimeout(() => focusFirst(ref.current?.closest('section') ?? null), 60)
  }, [step, active])
  useRemote((k) => {
    // Back walks back through the wizard before leaving it
    if (k !== 'back' || step === 'server') return false
    sfx.back()
    setStep(step === 'login' ? 'server' : step === 'share' ? (login.protocol === 'nfs' ? 'server' : 'login') : step === 'test' ? 'share' : 'test')
    return true
  }, active)

  const pickServer = (server: string, protocol: 'smb' | 'nfs') => {
    sfx.select()
    setLogin((l) => ({ ...l, server, protocol }))
    if (protocol === 'nfs') loadShares({ ...login, server, protocol })
    else setStep('login')
  }
  const loadShares = async (l: NetLogin) => {
    setShares(null)
    setShareErr('')
    setStep('share')
    try {
      setShares(await api.netShares(l))
    } catch (e) {
      setShareErr((e as Error).message)
    }
  }
  const runTest = async (share: string) => {
    sfx.select()
    const l = { ...login, share }
    setLogin(l)
    setTest(null)
    setStep('test')
    setTest(await api.netTest(l).catch((e) => ({ ok: false, steps: [{ id: 'error', ok: false, title: 'Test failed', detail: (e as Error).message }] })))
  }
  const add = async () => {
    sfx.select()
    setStep('adding')
    try {
      const name = (login.share ?? '').split('/').filter(Boolean).pop() || login.server
      const r = login.protocol === 'nfs'
        ? await api.addNfs({ name, server: login.server, share: login.share ?? '' })
        : await api.addShare({ name, server: login.server, share: login.share ?? '', path: '', username: login.username ?? '', password: login.password ?? '' })
      // wait for musicos-apply to mount it
      for (let i = 0; i < 30; i++) {
        const lib = await api.library().catch(() => null)
        const s = lib?.sources.find((x) => x.id === `net:${r.id}`)
        if (s?.online) return onAdded(s)
        if (i === 2 && s) {
          // touching the folder triggers the automount
          await api.libraryBrowse(s.id, '').catch(() => {})
        }
        await new Promise((res) => setTimeout(res, 1500))
      }
      setMsg('The share was saved but didn\'t connect yet. It appears in your sources as soon as it does.')
      setStep('test')
    } catch (e) {
      setMsg((e as Error).message)
      setStep('test')
    }
  }

  return (
    <div ref={ref} className="flex flex-col gap-3">
      {step === 'server' && (
        <>
          <Title sub="Servers on your network that share music folders">Network share</Title>
          {servers === null && <Spinner>Looking for servers…</Spinner>}
          {servers?.map((s) => (
            <Row key={s.address} icon={Server} title={s.name} sub={`${s.address} · ${s.protocols.map((p) => p.toUpperCase()).join(' and ')}`}
              trailing={<ChevronRight className="size-5 opacity-40" />}
              onClick={() => pickServer(s.address, s.protocols.includes('smb') ? 'smb' : 'nfs')} />
          ))}
          {servers?.length === 0 && <Empty>No servers announced themselves. Enter the address instead (for example 192.168.1.20).</Empty>}
          <Row icon={Search} title="Enter an address (SMB)" sub="Windows, macOS, Samba, most NAS boxes" onClick={() =>
            type({ label: 'Server address', value: login.server, done: (v) => v.trim() && pickServer(v.trim(), 'smb') })} />
          <Row icon={Search} title="Enter an address (NFS)" sub="Linux servers and NAS boxes with NFS on" onClick={() =>
            type({ label: 'NFS server address', value: login.server, done: (v) => v.trim() && pickServer(v.trim(), 'nfs') })} />
        </>
      )}

      {step === 'login' && (
        <>
          <Title sub={login.server}>Sign in</Title>
          <Row icon={User} title={login.username ? `Username: ${login.username}` : 'Username'} sub="The account on the server" onClick={() =>
            type({ label: 'Username', value: login.username ?? '', done: (v) => setLogin((l) => ({ ...l, username: v })) })} />
          <Row icon={KeyRound} title={login.password ? `Password: ${'•'.repeat(login.password.length)}` : 'Password'} onClick={() =>
            type({ label: 'Password', value: login.password ?? '', secret: true, done: (v) => setLogin((l) => ({ ...l, password: v })) })} />
          <Row icon={ChevronRight} title="Continue" sub={login.username ? `As ${login.username}` : 'Enter a username first, or continue as guest'}
            disabled={!login.username} onClick={login.username ? () => (sfx.select(), loadShares(login)) : undefined} />
          <Row icon={User} title="Continue as guest" sub="For shares open to everyone" onClick={() => {
            sfx.select()
            const l = { ...login, username: '', password: '' }
            setLogin(l)
            loadShares(l)
          }} />
        </>
      )}

      {step === 'share' && (
        <>
          <Title sub={`${login.server}${login.username ? ` · ${login.username}` : ''}`}>Choose a share</Title>
          {shares === null && !shareErr && <Spinner>Asking {login.server} for its shares…</Spinner>}
          {shareErr && <Empty>{shareErr}</Empty>}
          {shares?.map((s) => (
            <Row key={s.name} icon={Folder} title={s.name} sub={s.comment || (login.protocol === 'nfs' ? 'NFS export' : 'Shared folder')}
              trailing={<ChevronRight className="size-5 opacity-40" />} onClick={() => runTest(s.name)} />
          ))}
          {shares?.length === 0 && <Empty>This server shares no folders with this account.</Empty>}
          {shareErr && <Row icon={ArrowLeft} title="Change the login" onClick={() => (sfx.back(), setStep('login'))} />}
        </>
      )}

      {(step === 'test' || step === 'adding') && (
        <>
          <Title sub={`${login.protocol === 'nfs' ? '' : '//'}${login.server}${login.protocol === 'nfs' ? ':' : '/'}${login.share}`}>Connection test</Title>
          <div className="flex flex-col gap-1 rounded-[1.2rem] bg-white/[0.05] px-6 py-4">
            {!test && <Spinner>Testing the connection…</Spinner>}
            {test?.steps.map((s) => (
              <div key={s.id} className="mo-fade-in flex items-start gap-4 py-2">
                {s.ok === true ? <CircleCheck className="mt-0.5 size-[1.3rem] shrink-0 text-white/85" strokeWidth={1.75} />
                  : s.ok === false ? <CircleAlert className="mt-0.5 size-[1.3rem] shrink-0 text-white" strokeWidth={1.75} />
                    : <CircleDashed className="mt-0.5 size-[1.3rem] shrink-0 text-white/40" strokeWidth={1.75} />}
                <div>
                  <div className={`text-[1.02rem] font-medium ${s.ok === false ? 'text-white' : 'text-white/90'}`}>{s.title}</div>
                  {s.detail && <div className="text-[0.88rem] text-white/50">{s.detail}</div>}
                </div>
              </div>
            ))}
          </div>
          {step === 'adding' && <Spinner>Connecting the share…</Spinner>}
          {step === 'test' && test?.ok && <Row icon={Plus} title="Add this share" sub="Then choose the folders your music is in" onClick={add} />}
          {step === 'test' && test && <Row icon={RefreshCw} title="Test again" onClick={() => runTest(login.share ?? '')} />}
          {step === 'test' && test && !test.ok && login.protocol === 'smb' && <Row icon={KeyRound} title="Change the login" onClick={() => (sfx.back(), setStep('login'))} />}
        </>
      )}
    </div>
  )
}

function Spinner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-1 py-3 text-[0.95rem] text-white/55">
      <Loader2 className="mo-spin size-[1.2rem]" strokeWidth={2} />
      {children}
    </div>
  )
}
