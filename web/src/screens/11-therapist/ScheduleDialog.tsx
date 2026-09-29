import { useState } from 'react'
import { Button } from '../../design/Button'
import { Checkbox } from '../../design/Checkbox'
import { Field } from '../../design/Field'
import { Check } from '../../design/Icon'
import { Overlay, OverlayActions } from '../../design/Overlay'
import { Pill } from '../../design/Pill'
import { api, type Prescription, type Schedule } from '../../lib/api'
import { WEEKDAYS } from '../../lib/calendar'
import { plural } from '../../lib/plural'

/** The seed schedule, for a service that predates 28 Sep (its prescription has no schedule). */
export const DEFAULT_SCHEDULE: Schedule = { practice_days: [0, 1, 2, 3, 4], nhpt_day: 6, next_visit: { at: '2026-10-01T14:30', with: 'Dr. Anita Rao, OT' }, minutes_per_day: 10 }

type Props = { schedule: Schedule; version: number; onClose: () => void; onSaved: (rx: Prescription) => void }

/** Therapist view · Edit practice days (screen 12's schedule lives in the prescription).
 *  Weekday toggles, the peg-test day and the next clinic visit; saved through
 *  `PUT /api/prescription/schedule` as prescription v(N+1). The dose is not editable here.
 *  Pressed toggles are filled and show a check, so state is not colour-only. Mount it only
 *  while open, so it always starts from the current schedule. */
export function ScheduleDialog({ schedule, version, onClose, onSaved }: Props) {
  const [days, setDays] = useState<number[]>(schedule.practice_days)
  const [pegDay, setPegDay] = useState(String(schedule.nhpt_day))
  const [booked, setBooked] = useState(schedule.next_visit != null)
  const [date, setDate] = useState(schedule.next_visit?.at.slice(0, 10) ?? '')
  const [time, setTime] = useState(schedule.next_visit?.at.slice(11, 16) || '14:30')
  const [who, setWho] = useState(schedule.next_visit?.with ?? 'Dr. Anita Rao, OT')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (d: number) => setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d].sort((a, b) => a - b)))
  const visitOk = !booked || (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) && who.trim().length > 0)
  const canSave = days.length > 0 && visitOk && !saving
  const next = version + 1

  const save = () => {
    setSaving(true)
    setError(null)
    api
      .putSchedule({ practice_days: days, nhpt_day: Number(pegDay), next_visit: booked ? { at: `${date}T${time}`, with: who.trim() } : null })
      .then(onSaved)
      .catch((e) => {
        setError(`Could not save: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`)
        setSaving(false)
      })
  }

  return (
    <Overlay open title="Edit practice days" description="Practice days, the peg-test day and the next clinic visit. Saved as a new prescription version." onClose={onClose} className="w-[min(820px,92vw)]">
      <fieldset className="mt-6">
        <legend className="mb-2 text-xl font-bold">Practice days</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d, i) => {
            const on = days.includes(i)
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(i)}
                className={`inline-flex min-h-14 min-w-20 items-center justify-center gap-1.5 rounded-[var(--r-control)] border-2 px-3 text-lg font-bold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]/40 ${on ? 'border-teal-fill bg-teal-fill text-white' : 'border-line bg-surface text-ink hover:bg-tint-mint'}`}
              >
                {on && <Check aria-hidden className="h-5 w-5" strokeWidth={3} />}
                {d}
              </button>
            )
          })}
        </div>
        {days.length ? (
          <p className="mt-2 text-lg text-muted">{days.length} practice {plural(days.length, 'day')} a week</p>
        ) : (
          <p className="mt-2 text-lg font-bold text-red-ink" role="alert">Choose at least one practice day.</p>
        )}
      </fieldset>

      <fieldset className="mt-6">
        <legend className="mb-2 text-xl font-bold">Nine-Hole Peg Test day (weekly)</legend>
        <Pill ariaLabel="Peg-test day" value={pegDay} onChange={setPegDay} options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} className="flex-wrap" />
      </fieldset>

      <fieldset className="mt-6">
        <legend className="mb-1 text-xl font-bold">Next clinic visit</legend>
        <Checkbox label="A clinic visit is booked" checked={booked} onChange={setBooked} />
        {booked && (
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)] gap-3">
            <Field label="Visit date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Field label="Visit time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            <Field label="With" value={who} onChange={(e) => setWho(e.target.value)} maxLength={80} />
          </div>
        )}
      </fieldset>

      {error && <p className="mt-4 text-lg text-red-ink" role="alert">{error}</p>}
      <p className="mt-4 text-base text-muted">Saved as prescription v{next}. The dose, allowed adaptations and stop rules stay as they are.</p>
      <OverlayActions>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={!canSave} onClick={save}>{saving ? 'Saving…' : `Save as v${next}`}</Button>
      </OverlayActions>
    </Overlay>
  )
}
