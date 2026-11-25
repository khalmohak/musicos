import type { SVGProps } from 'react'

/** A TV remote drawn in Lucide's style (24px grid, 2px rounded strokes); Lucide has none. */
export function RemoteIcon({ size = 24, strokeWidth = 2, ...rest }: SVGProps<SVGSVGElement> & { size?: number | string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <rect x="7" y="2" width="10" height="20" rx="5" />
      <circle cx="12" cy="8" r="2.2" />
      <path d="M12 14v.01M12 17.5v.01" />
    </svg>
  )
}
