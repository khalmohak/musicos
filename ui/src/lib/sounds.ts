// Interface sounds, synthesised with WebAudio: no audio files to ship. Quiet by design,
// and silent while music is playing so they never sit on top of a record.
let ctx: AudioContext | null = null
let enabled = true
let musicPlaying = false

export function configureSounds(opts: { enabled?: boolean; musicPlaying?: boolean }) {
  if (opts.enabled !== undefined) enabled = opts.enabled
  if (opts.musicPlaying !== undefined) musicPlaying = opts.musicPlaying
}

function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/** Unlock audio on first interaction (autoplay policies). */
export function primeAudio() {
  ac()
}

function tone(freq: number, at: number, dur: number, peak: number, type: OscillatorType = 'sine', glideTo?: number) {
  const c = ac()
  if (!c) return
  const t = c.currentTime + at
  const osc = c.createOscillator()
  const gain = c.createGain()
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 2400
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(lp).connect(gain).connect(c.destination)
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

const quiet = () => !enabled || musicPlaying

export const sfx = {
  /** focus moved */
  tick() {
    if (quiet()) return
    tone(1850, 0, 0.035, 0.018, 'triangle')
  },
  /** item chosen */
  select() {
    if (quiet()) return
    tone(140, 0, 0.16, 0.12, 'sine', 70)
    tone(1200, 0, 0.03, 0.02, 'triangle')
  },
  /** went back */
  back() {
    if (quiet()) return
    tone(660, 0, 0.07, 0.03, 'triangle')
    tone(440, 0.06, 0.09, 0.03, 'triangle')
  },
  /** end of a list: soft bump */
  edge() {
    if (quiet()) return
    tone(90, 0, 0.08, 0.05)
  },
  /** startup: a slow warm chord (G major add9), only if nothing is playing */
  boot() {
    if (!enabled || musicPlaying) return
    const notes = [196, 293.66, 392, 440]
    notes.forEach((f, i) => tone(f, i * 0.09, 2.2 - i * 0.2, 0.05 - i * 0.008))
  },
  /** setup finished */
  done() {
    if (quiet()) return
    ;[392, 493.88, 587.33, 783.99].forEach((f, i) => tone(f, i * 0.07, 0.9, 0.04))
  },
}
