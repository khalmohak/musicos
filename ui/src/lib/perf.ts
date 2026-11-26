/**
 * Frame-time probe (diagnostics, off unless config.perfProbe is set over SSH): measures every
 * frame and posts a summary every 5 s to the agent, which logs it, so smoothness can be
 * checked on the real TV instead of guessed. Frames over 20 ms miss 60 Hz.
 */
let started = false

export function startPerfProbe(screen: () => string) {
  if (started) return
  started = true
  let last = performance.now()
  let frames: number[] = []
  const tick = (t: number) => {
    frames.push(t - last)
    last = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  setInterval(() => {
    const f = frames.slice(1)
    frames = []
    if (f.length < 10) return
    const s = [...f].sort((a, b) => a - b)
    const pct = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10
    const body = {
      screen: screen(), frames: f.length, fps: Math.round(f.length / (f.reduce((a, b) => a + b, 0) / 1000)),
      p50: pct(0.5), p95: pct(0.95), max: Math.round(s[s.length - 1]),
      missed: f.filter((x) => x > 20).length, long: f.filter((x) => x > 50).length,
    }
    fetch('/api/perf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {})
  }, 5000)
}
