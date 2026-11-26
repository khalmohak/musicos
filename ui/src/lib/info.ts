import { useEffect, useState } from 'react'
import { type AlbumInfo, type ArtistNotes, type TrackCard, api } from './api'

const albums = new Map<string, AlbumInfo>()
const artists = new Map<string, ArtistNotes>()
const cards = new Map<string, TrackCard>()

/** Album notes: cached in memory; while the box is still preparing them, ask again every 4 s. */
export function useAlbumInfo(artist?: string, album?: string) {
  const key = artist && album ? `${artist}\u0000${album}` : ''
  const [info, setInfo] = useState<AlbumInfo | null>(() => (key ? albums.get(key) ?? null : null))
  useEffect(() => {
    if (!key || !artist || !album) return setInfo(null)
    const cached = albums.get(key)
    setInfo(cached ?? null)
    if (cached && cached.status !== 'pending') return
    let alive = true
    let tries = 0
    const load = () =>
      api.albumInfo(artist, album).then((d) => {
        if (!alive) return
        if (d.status !== 'pending') albums.set(key, d)
        setInfo(d)
        if (d.status === 'pending' && tries++ < 45) t = window.setTimeout(load, 4000)
      }).catch(() => {})
    let t = 0
    load()
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [key])
  return info
}

export function useArtistInfo(name?: string) {
  const [info, setInfo] = useState<ArtistNotes | null>(() => (name ? artists.get(name) ?? null : null))
  useEffect(() => {
    if (!name) return setInfo(null)
    const cached = artists.get(name)
    setInfo(cached ?? null)
    if (cached && cached.status !== 'pending') return
    let alive = true
    let tries = 0
    let t = 0
    const load = () =>
      api.artistInfo(name).then((d) => {
        if (!alive) return
        if (d.status !== 'pending') artists.set(name, d)
        setInfo(d)
        if (d.status === 'pending' && tries++ < 45) t = window.setTimeout(load, 4000)
      }).catch(() => {})
    load()
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [name])
  return info
}

/** The playing song's card. Asking for it also queues the rest of its album (on the box). */
export function useTrackCard(artist?: string, album?: string, title?: string) {
  const key = artist && album && title ? `${artist}\u0000${album}\u0000${title}` : ''
  const [card, setCard] = useState<TrackCard | null>(() => (key ? cards.get(key) ?? null : null))
  useEffect(() => {
    if (!key || !artist || !album || !title) return setCard(null)
    const cached = cards.get(key)
    setCard(cached ?? null)
    if (cached && cached.status !== 'pending') return
    let alive = true
    let tries = 0
    let t = 0
    const load = () =>
      api.trackCard(artist, album, title).then((d) => {
        if (!alive) return
        if (d.status !== 'pending') cards.set(key, d)
        setCard(d)
        if (d.status === 'pending' && tries++ < 60) t = window.setTimeout(load, 3000)
      }).catch(() => {})
    load()
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [key])
  return card
}

/** What the facts line under the title cycles through: things to listen for, then the moment. */
export function cardLines(card: TrackCard | null): { label: string; text: string }[] {
  if (!card || card.status !== 'ready') return []
  return [
    ...(card.listenFor ?? []).map((text) => ({ label: 'Listen for', text })),
    ...(card.moment ? [{ label: 'The moment', text: card.moment }] : []),
  ]
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Facts in the order to show them while `track` plays: about this track first, then the album. */
export function factsFor(info: AlbumInfo | null, track?: string) {
  const facts = info?.facts ?? []
  const t = track ? norm(track) : ''
  const mine = facts.filter((f) => f.track && t && (norm(f.track) === t || norm(f.track).startsWith(t) || t.startsWith(norm(f.track))))
  return [...mine, ...facts.filter((f) => !f.track)]
}
