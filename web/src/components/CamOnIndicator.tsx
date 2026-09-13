/** Global rule: a red "CAM ON" indicator is shown whenever the webcam is active. */
export function CamOnIndicator({ active }: { active: boolean }) {
  if (!active) return null
  return (
    <span
      role="status"
      aria-label="Camera active"
      data-active="true"
      className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-lg font-bold uppercase tracking-wide text-white shadow"
    >
      <span aria-hidden className="h-3 w-3 animate-pulse rounded-full bg-white" />
      CAM ON
    </span>
  )
}
