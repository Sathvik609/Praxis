import { Camera } from '../design/Icon'

/** Red dot + "Live · not recording" whenever the camera is active; amber dot + "Replay" when a
 *  recorded session runs on the service. The text carries the meaning, the dot and icon are
 *  decorative. ≥ 18 px, white on the stage, ink on a surface. */
export function LiveIndicator({ active, replay = false, className = '' }: { active: boolean; replay?: boolean; className?: string }) {
  if (!active) return null
  return (
    <span role="status" className={`inline-flex items-center gap-2 whitespace-nowrap text-lg font-bold ${className}`}>
      <Camera aria-hidden className="h-5 w-5" />
      <span aria-hidden className={`h-3 w-3 rounded-full ${replay ? 'bg-amber' : 'bg-red'} ${replay ? '' : 'animate-pulse'}`} />
      {replay ? 'Replay' : 'Live · not recording'}
    </span>
  )
}
