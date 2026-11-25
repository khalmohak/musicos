import { Record, Wordmark } from '../components/Record'

/** Same composition as the Plymouth splash, so the hand-off from boot to UI is seamless. */
export function Boot({ leaving }: { leaving: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-[2.4rem] bg-[rgb(9_9_11)] transition-opacity duration-700"
      style={{ opacity: leaving ? 0 : 1 }}
    >
      <Record size="min(26vh, 14rem)" />
      <Wordmark className="text-[1.05rem]" />
    </div>
  )
}
