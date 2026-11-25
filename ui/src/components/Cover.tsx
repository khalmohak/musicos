import { Disc3 } from 'lucide-react'
import { useState } from 'react'
import { coverUrl } from '../lib/api'

/** Album art; albums without art get a quiet, typographic sleeve instead of a broken image. */
export function Cover({
  file, title, artist, fraction = 0.12, className = '', eager = false,
}: { file?: string; title: string; artist?: string; fraction?: number; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(!file)
  return (
    <div className={`relative overflow-hidden bg-[rgb(28_28_32)] ${className}`}>
      {!failed && file ? (
        <img
          src={coverUrl(file, fraction)}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-br from-[rgb(38_38_44)] to-[rgb(20_20_24)] p-[9%]">
          <Disc3 className="size-[22%] text-white/25" strokeWidth={1.5} />
          <div>
            <div className="line-clamp-3 text-[1em] leading-tight font-semibold text-white/85">{title}</div>
            {artist && <div className="mt-1 truncate text-[0.78em] text-white/45">{artist}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
