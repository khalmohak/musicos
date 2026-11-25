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
  song: Song | null
}
export interface Config {
  setupComplete: boolean
  name: string
  uiSounds: boolean
  audioDevice: string
  bitPerfect: boolean
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
  kind: 'default' | 'hdmi' | 'usb' | 'analog'
  detail: string
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
  outputs: () => req<AudioOutput[]>('/api/audio/outputs'),
  setOutput: (id: string) => req<Config>('/api/audio/output', { id }),
  testSound: (id: string) => req<{ ok: boolean }>('/api/audio/test', { id }),
  setBitPerfect: (on: boolean) => req<Config>('/api/audio/bitperfect', { on }),
  network: () => req<Network>('/api/network'),
  wifiScan: () => req<WifiNetwork[]>('/api/network/wifi'),
  wifiConnect: (ssid: string, password: string) => req<{ ok: boolean }>('/api/network/wifi', { ssid, password }),
  access: () => req<Access>('/api/access'),
  sources: () => req<Source[]>('/api/sources'),
  addShare: (s: { name: string; server: string; share: string; path: string; username: string; password: string }) =>
    req<{ id: string }>('/api/sources/smb', s),
  removeSource: (id: string) => req<{ ok: boolean }>('/api/sources/remove', { id }),
}

export const coverUrl = (file: string, size = 480) => `/api/art?file=${q(file)}&size=${size}`
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
