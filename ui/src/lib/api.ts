export interface AudioFormat {
  rate: number
  bits: number
  channels: number
  float?: boolean
  dsd?: string
}
export interface Album {
  album: string
  artist: string
  year: string
  file: string
  tracks: number
  codec?: string
  format?: AudioFormat | null
}
export interface Track {
  file: string
  title: string
  track: string
  duration: number
  codec?: string
  format?: AudioFormat | null
}
export interface Song {
  file: string
  title: string
  artist: string
  album: string
  codec?: string
  format?: AudioFormat | null
}
export interface Status {
  state: 'play' | 'pause' | 'stop'
  volume: number
  elapsed: number
  duration: number
  audio?: AudioFormat | null
  bitrate?: number
  pos?: number
  queueLength?: number
  song: Song | null
  receiver?: Receiver | null
}
export interface Receiver {
  active: boolean
  source: 'airplay' | 'spotify'
  state: 'play' | 'pause' | ''
  title: string
  artist: string
  album: string
  cover: string
  duration: number
  position: number
  device: string
}
export interface UpdateStatus {
  current: string
  staged: string | null
  install: '' | 'queued' | 'installing' | 'installed' | 'failed' | 'rolledback'
  installVersion: string
  progress: { state: string; done: number; total: number; error: string }
  url: string
  usb: { path: string; version: string }[]
  available: string
  checked: number
  checkError: string
  log: string[]
}
export interface InstallDisk {
  path: string
  name: string
  serial: string
  size: number
  sizeText: string
  kind: string
  usb: boolean
  parts: { name: string; mounted: string[] }[]
  ok?: boolean
  why?: string
}
export interface InstallStatus {
  state: 'idle' | 'queued' | 'running' | 'done' | 'failed'
  step?: string
  pct?: number
  target?: string
  error?: string
  warning?: string
}
export interface InstallInfo {
  disks: InstallDisk[]
  boot: InstallDisk | null
  needed: number
  neededText: string
  fromUsb: boolean
  status: InstallStatus
}
export interface ReceiversInfo {
  name: string
  airplay: { on: boolean; installed: boolean }
  spotify: { on: boolean; installed: boolean }
}
export interface QueueItem {
  pos: number
  file: string
  title: string
  artist: string
  album: string
  duration: number
  current: boolean
}
export interface SearchTrack {
  file: string
  title: string
  artist: string
  album: string
  duration: number
}
export interface SearchResult {
  artists: { artist: string; file: string }[]
  albums: Album[]
  tracks: SearchTrack[]
}
export interface Lyrics {
  synced: boolean
  lines: { t: number | null; text: string }[]
}
export interface BtDevice {
  mac: string
  name: string
  kind: 'controller' | 'keyboard' | 'audio' | 'phone' | 'other'
  paired: boolean
  connected: boolean
}
export interface BtState {
  available: boolean
  powered: boolean
  demo?: boolean
  devices: BtDevice[]
}
export interface DisplayInfo {
  outputs: { name: string; current: string; recommended?: string; modes: string[] }[]
  demo: boolean
}
export interface Connection {
  name: string
  type: 'ethernet' | 'wifi'
  method: string
}
export interface ArtistEntry {
  artist: string
  albums: number
  file: string
  photo: boolean
}
export interface ArtistInfo {
  artist: string
  albums: Album[]
  file: string
  photo: boolean
  backdrop: boolean
  logo: boolean
}
export interface Config {
  setupComplete: boolean
  name: string
  uiSounds: boolean
  audioDevice: string
  bitPerfect: boolean
  screensaver: number
  autoSleep: number
  sleepSystem: boolean
  uiScale: number
  overscan: number
  displayMode: string
  onlineArt: boolean
}
export interface Stats {
  artists: number
  albums: number
  songs: number
  updating: boolean
}
export interface AudioOutput {
  id: string
  name: string
  kind: 'default' | 'hdmi' | 'usb' | 'analog' | 'bluetooth'
  detail: string
  connected?: boolean | null
}
export interface Source {
  id: string
  kind: 'local' | 'usb' | 'disk' | 'network' | 'folder'
  name: string
  mounted: boolean
  path?: string
  total?: number
  free?: number
}
export interface Network {
  demo: boolean
  internet: boolean
  ethernet: { present: boolean; connected: boolean; ip: string }
  wifi: { present: boolean; connected: boolean; ssid: string; signal: number; ip: string }
}
export interface WifiNetwork {
  ssid: string
  signal: number
  secure: boolean
  active: boolean
}
export interface Access {
  hostname: string
  mdns: string
  ips: string[]
  ssh: boolean
  user: string
  dropFolder: string
  remoteUrl: string
}
export interface Info {
  hostname: string
  ips: string[]
  port: number
  backend: string
}

async function req<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`)
  return data as T
}

const q = encodeURIComponent

export const api = {
  status: () => req<Status>('/api/status'),
  info: () => req<Info>('/api/info'),
  config: () => req<Config>('/api/config'),
  saveConfig: (c: Partial<Config>) => req<Config>('/api/config', c),
  stats: () => req<Stats>('/api/stats'),
  rescan: () => req<Stats>('/api/update', {}),
  albums: () => req<Album[]>('/api/albums'),
  tracks: (a: Album) => req<Track[]>(`/api/tracks?artist=${q(a.artist)}&album=${q(a.album)}`),
  play: (a: Album, pos = 0) => req<Status>('/api/play', { artist: a.artist, album: a.album, pos }),
  control: (action: 'toggle' | 'next' | 'previous' | 'stop') => req<Status>('/api/control', { action }),
  volume: (volume: number) => req<Status>('/api/volume', { volume }),
  seek: (to: number) => req<Status>('/api/seek', { to }),
  outputs: () => req<AudioOutput[]>('/api/audio/outputs'),
  setOutput: (id: string) => req<Config>('/api/audio/output', { id }),
  testSound: (id: string) => req<{ ok: boolean }>('/api/audio/test', { id }),
  setBitPerfect: (on: boolean) => req<Config>('/api/audio/bitperfect', { on }),
  network: () => req<Network>('/api/network'),
  wifiScan: () => req<WifiNetwork[]>('/api/network/wifi'),
  wifiConnect: (ssid: string, password: string) => req<{ ok: boolean }>('/api/network/wifi', { ssid, password }),
  access: () => req<Access>('/api/access'),
  power: (action: 'shutdown' | 'reboot' | 'sleep' | 'tv-off') => req<{ ok: boolean }>('/api/power', { action }),
  activity: () => req<{ ok: boolean }>('/api/activity', {}),
  timezones: () => req<{ current: string; regions: Record<string, string[]> }>('/api/timezones'),
  setTimezone: (zone: string) => req<{ ok: boolean }>('/api/timezone', { zone }),
  display: () => req<DisplayInfo>('/api/display'),
  setDisplay: (output: string, mode: string) => req<Config>('/api/display', { output, mode }),
  bluetooth: () => req<BtState>('/api/bluetooth'),
  btScan: () => req<{ ok: boolean }>('/api/bluetooth/scan', {}),
  btPair: (mac: string) => req<{ ok: boolean }>('/api/bluetooth/pair', { mac }),
  btForget: (mac: string) => req<{ ok: boolean }>('/api/bluetooth/forget', { mac }),
  wifiSaved: () => req<{ name: string; active: boolean; method: string }[]>('/api/wifi/saved'),
  wifiForget: (name: string) => req<{ ok: boolean }>('/api/wifi/forget', { name }),
  wifiHidden: (ssid: string, password: string) => req<{ ok: boolean }>('/api/wifi/hidden', { ssid, password }),
  connections: () => req<Connection[]>('/api/connections'),
  setIpv4: (b: { connection: string; method: 'auto' | 'manual'; address?: string; prefix?: number; gateway?: string; dns?: string }) =>
    req<{ ok: boolean }>('/api/ipv4', b),
  receivers: () => req<ReceiversInfo>('/api/receivers'),
  setReceivers: (b: { airplay?: boolean; spotify?: boolean; name?: string }) => req<{ ok: boolean }>('/api/receivers', b),
  update: () => req<UpdateStatus>('/api/update'),
  checkUpdate: (url?: string) => req<{ upToDate: boolean; version: string }>('/api/update/check', url ? { url } : {}),
  updateFromUsb: (path: string) => req<{ version: string }>('/api/update/usb', { path }),
  installUpdate: () => req<{ ok: boolean }>('/api/update/install', {}),
  installInfo: () => req<InstallInfo>('/api/install'),
  installTo: (d: InstallDisk) => req<{ ok: boolean }>('/api/install', { path: d.path, serial: d.serial, size: d.size }),
  report: () => req<{ text: string; at: number }>('/api/report'),
  refreshReport: () => req<{ ok: boolean }>('/api/report', {}),
  sources: () => req<Source[]>('/api/sources'),
  queue: () => req<QueueItem[]>('/api/queue'),
  playPos: (pos: number) => req<Status>('/api/queue/play', { pos }),
  enqueue: (a: Album, mode: 'next' | 'end') => req<Status>('/api/queue/add', { artist: a.artist, album: a.album, mode }),
  clearQueue: () => req<Status>('/api/queue/clear', {}),
  shuffle: (artist?: string, album?: string) => req<Status>('/api/shuffle', { artist, album }),
  search: (term: string) => req<SearchResult>(`/api/search?q=${q(term)}`),
  lyrics: (file: string) => req<Lyrics>(`/api/lyrics?file=${q(file)}`),
  artists: () => req<ArtistEntry[]>('/api/artist-index'),
  artist: (name: string) => req<ArtistInfo>(`/api/artist?name=${q(name)}`),
  addShare: (s: { name: string; server: string; share: string; path: string; username: string; password: string }) =>
    req<{ id: string }>('/api/sources/smb', s),
  removeSource: (id: string) => req<{ ok: boolean }>('/api/sources/remove', { id }),
}

/**
 * Cover URL sized for how big it is on screen: `fraction` is the cover's width as a share of the
 * screen width. Sizes snap to steps of 160 px so the agent's cache stays small (4K wall ≈ 480 px,
 * 4K album view ≈ 1440 px).
 */
export function coverUrl(file: string, fraction = 0.12) {
  const px = window.innerWidth * (window.devicePixelRatio || 1) * fraction
  const size = Math.min(1600, Math.max(160, Math.ceil(px / 160) * 160))
  return `/api/art?file=${q(file)}&size=${size}`
}
/** Artist photo / backdrop / logo from the artist's folder (folder.jpg, backdrop1.jpg, logo.png). */
export function artistArtUrl(file: string, artist: string, kind: 'photo' | 'backdrop' | 'logo', fraction = 0.15) {
  const px = window.innerWidth * (window.devicePixelRatio || 1) * fraction
  const size = Math.min(2400, Math.max(160, Math.ceil(px / 160) * 160))
  return `/api/artist-art?file=${q(file)}&artist=${q(artist)}&kind=${kind}&size=${size}`
}

/** Pre-blurred tiny cover for full-screen backdrops: no CSS blur on the device. */
export const backdropUrl = (file: string) => `/api/art?file=${q(file)}&blur=1`

export const fmtTime = (s: number) => {
  const t = Math.max(0, Math.floor(s || 0))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

export const albumKey = (a: { artist: string; album: string }) => `${a.artist}\u0000${a.album}`

/** "24-bit / 96 kHz", "16-bit / 44.1 kHz", "DSD64" */
export function fmtFormat(f?: AudioFormat | null) {
  if (!f) return ''
  if (f.dsd) return f.dsd
  const khz = f.rate / 1000
  const rate = `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`
  return f.float ? `32-bit float / ${rate}` : `${f.bits}-bit / ${rate}`
}

/** CD quality or better than CD */
export const isHiRes = (f?: AudioFormat | null) => !!f && (!!f.dsd || f.bits > 16 || f.rate > 48000)

export function fmtBytes(n?: number) {
  if (!n) return ''
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000
    i++
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`
}
