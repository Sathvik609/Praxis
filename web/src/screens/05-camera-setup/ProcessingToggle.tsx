export function ProcessingToggle() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-lg">Processing</span>
        <button type="button" aria-pressed className="min-h-14 rounded-full bg-teal px-5 font-bold text-white">
          On this device
        </button>
        <button
          type="button"
          disabled
          title="Available in cloud mode (later phase)"
          className="min-h-14 rounded-full border-2 border-line px-5 text-muted"
        >
          Cloud, with consent · not available yet
        </button>
      </div>
      <p className="mt-3 text-muted">Video is not stored. Only measurements and events are saved.</p>
    </div>
  )
}
