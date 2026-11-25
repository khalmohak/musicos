/** The musicos mark: a vinyl record. Neutral label by default; pass `accent` to tint it with the album. */
export function Record({ size = '10rem', spinning = true, accent = false }: { size?: string; spinning?: boolean; accent?: boolean }) {
  const grooves = Array.from({ length: 14 }, (_, i) => 46 - i * 1.9)
  return (
    <svg viewBox="0 0 100 100" style={{ width: size, height: size }} className={spinning ? 'mo-spin' : undefined} aria-hidden>
      <defs>
        <radialGradient id="mo-disc" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#26262b" />
          <stop offset="100%" stopColor="#111114" />
        </radialGradient>
        <linearGradient id="mo-sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0" />
          <stop offset="45%" stopColor="#fff" stopOpacity="0.09" />
          <stop offset="55%" stopColor="#fff" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="mo-label" cx="40%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#f4f3f0" />
          <stop offset="100%" stopColor="#c9c8c4" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="49" fill="url(#mo-disc)" stroke="#3b3b42" strokeWidth="0.6" />
      {grooves.map((r) => (
        <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#2e2e34" strokeWidth="0.32" />
      ))}
      <circle cx="50" cy="50" r="49" fill="url(#mo-sheen)" />
      <circle
        cx="50"
        cy="50"
        r="16.5"
        fill={accent ? 'rgb(var(--mo-accent))' : 'url(#mo-label)'}
        style={{ transition: 'fill 900ms ease' }}
      />
      <circle cx="50" cy="50" r="11" fill="none" stroke="#000" strokeOpacity="0.12" strokeWidth="0.5" />
      <circle cx="50" cy="50" r="2" fill="#0a0a0c" />
    </svg>
  )
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <div className={`font-normal tracking-[0.5em] text-white/70 lowercase ${className}`} style={{ paddingLeft: '0.5em' }}>
      musicos
    </div>
  )
}
