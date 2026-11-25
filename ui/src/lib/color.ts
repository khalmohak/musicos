// Pull a usable accent colour out of an album cover: the most "present" saturated
// colour, nudged bright enough to read on near-black. Results are cached per URL.
const cache = new Map<string, string>()

export async function coverAccent(url: string): Promise<string | null> {
  if (cache.has(url)) return cache.get(url) ?? null
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  try {
    await img.decode()
  } catch {
    return null
  }
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)

  // bucket by hue, weight by saturation * mid-brightness
  const buckets = new Map<number, { w: number; r: number; g: number; b: number }>()
  let grey = { w: 0, r: 0, g: 0, b: 0 }
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const l = (max + min) / 510
    const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255))
    if (s < 0.18 || l < 0.08 || l > 0.95) {
      grey = { w: grey.w + 1, r: grey.r + r, g: grey.g + g, b: grey.b + b }
      continue
    }
    let h = 0
    if (max === r) h = ((g - b) / (max - min)) % 6
    else if (max === g) h = (b - r) / (max - min) + 2
    else h = (r - g) / (max - min) + 4
    const key = Math.round(((h * 60 + 360) % 360) / 24)
    const w = s * (1 - Math.abs(l - 0.5) * 1.4)
    const cur = buckets.get(key) ?? { w: 0, r: 0, g: 0, b: 0 }
    buckets.set(key, { w: cur.w + w, r: cur.r + r * w, g: cur.g + g * w, b: cur.b + b * w })
  }
  let best: { w: number; r: number; g: number; b: number } | null = null
  for (const v of buckets.values()) if (!best || v.w > best.w) best = v
  let rgb: [number, number, number]
  if (best && best.w > 3) rgb = [best.r / best.w, best.g / best.w, best.b / best.w]
  else if (grey.w) rgb = [grey.r / grey.w, grey.g / grey.w, grey.b / grey.w]
  else return null

  // lift dark colours so the glow reads on black, keep hue
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  const lift = lum < 110 ? 110 / Math.max(lum, 1) : 1
  const out = rgb.map((c) => Math.round(Math.min(255, c * lift))).join(' ')
  cache.set(url, out)
  return out
}

let pending = 0
/** Set the global accent (debounced so fast scrolling doesn't thrash). */
export function setAccentFrom(url: string | null) {
  const id = ++pending
  window.setTimeout(async () => {
    if (id !== pending || !url) return
    const c = await coverAccent(url)
    if (id === pending && c) document.documentElement.style.setProperty('--mo-accent', c)
  }, 120)
}
