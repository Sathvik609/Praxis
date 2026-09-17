import * as Dialog from '@radix-ui/react-dialog'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlowBar } from '../../app/FlowBar'
import { Button } from '../../design/Button'
import { Card } from '../../design/Card'
import { Checkbox } from '../../design/Checkbox'
import { Chip } from '../../design/Chip'
import { X } from '../../design/Icon'
import { Pill } from '../../design/Pill'
import { ASSIGNED_TODAY, DEFAULT_EQUIPMENT, EQUIPMENT, EXERCISES, type EquipmentId, type Exercise, type ExerciseId } from '../../lib/seed'

const BADGE: Record<Exercise['kind'], { tone: 'neutral' | 'mint'; text: string }> = {
  assessment: { tone: 'neutral', text: 'Assessment' },
  camera: { tone: 'mint', text: 'Camera coached' },
  instructions: { tone: 'neutral', text: 'Instructions only' },
}
type Filter = 'assigned' | 'all' | 'equipment'
const EQUIPMENT_KEY = 'praxis.equipment'

function readEquipment(): EquipmentId[] {
  try {
    const raw = localStorage.getItem(EQUIPMENT_KEY)
    return raw ? (JSON.parse(raw) as EquipmentId[]) : DEFAULT_EQUIPMENT
  } catch {
    return DEFAULT_EQUIPMENT
  }
}
function readSide(): string {
  try {
    return JSON.parse(sessionStorage.getItem('praxis.profile') ?? '{}').side ?? 'left'
  } catch {
    return 'left'
  }
}

/** Centered sheet on the Radix Dialog: closes on Escape and on the overlay, always has a
 *  title and a description for assistive tech. */
function Sheet({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(880px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[var(--r-card)] bg-surface p-8 text-ink shadow-[var(--shadow-2)]">
          <div className="flex items-start gap-3">
            <Dialog.Title className="text-3xl">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="link" className="ml-auto min-h-14 w-14 shrink-0 px-0" aria-label="Close" icon={<X />} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-muted">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

type Time = '5' | '15'
type Pain = 'none' | 'some' | 'high'
type HasKit = 'yes' | 'no'

/** Rule-based pick from three answers. High pain is a stop rule, not a recommendation. */
function suggest(time: Time | null, pain: Pain | null, kit: HasKit | null): { pick: ExerciseId | null; why: string } {
  if (pain === 'high') return { pick: null, why: 'Pain at 5 or more is a stop rule in your program. Skip practice today and tell your therapist at check-in.' }
  if (!time || !pain || !kit) return { pick: null, why: 'Answer all three and Praxis will suggest one assigned task.' }
  const pick: ExerciseId = kit === 'yes' ? 'cup' : 'arm'
  const name = EXERCISES.find((e) => e.id === pick)?.name ?? pick
  const then = time === '15' ? (pick === 'cup' ? ', then Arm to the front if you still feel fresh' : ', then Waiter – cup once the sheet is out') : ''
  const care = pain === 'some' ? ' Keep to the slow arcs and stop if pain rises.' : ''
  return { pick, why: `${name}${then}.${care}` }
}

/** Screen 04 · Choose exercise. Assigned tasks first; cards select on tap and the one primary
 *  action lives in the flow bar. Camera coaching only where Praxis can verify the task. */
export function ChooseExercise() {
  const nav = useNavigate()
  const [filter, setFilter] = useState<Filter>('assigned')
  const [selected, setSelected] = useState<ExerciseId>(ASSIGNED_TODAY[0])
  const [sheet, setSheet] = useState<Exercise | null>(null)
  const [logged, setLogged] = useState<Record<string, number>>({})
  const [owned, setOwned] = useState<EquipmentId[]>(() => readEquipment())
  const [kitOpen, setKitOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [time, setTime] = useState<Time | null>(null)
  const [pain, setPain] = useState<Pain | null>(null)
  const [kit, setKit] = useState<HasKit | null>(null)
  const side = readSide()

  const assignedFirst = [...EXERCISES].sort((a, b) => Number(ASSIGNED_TODAY.includes(b.id)) - Number(ASSIGNED_TODAY.includes(a.id)))
  const list = filter === 'assigned' ? assignedFirst.filter((e) => ASSIGNED_TODAY.includes(e.id)) : filter === 'equipment' ? assignedFirst.filter((e) => e.needs.every((n) => owned.includes(n))) : assignedFirst
  const current = EXERCISES.find((e) => e.id === selected) ?? EXERCISES[0]
  const currentVisible = list.some((e) => e.id === selected)

  const saveOwned = (next: EquipmentId[]) => {
    setOwned(next)
    try {
      localStorage.setItem(EQUIPMENT_KEY, JSON.stringify(next))
    } catch {
      /* private mode */
    }
  }
  const begin = () => nav(`/details/setup?exercise=${current.id}&side=${side}`)
  const advice = suggest(time, pain, kit)
  const usePick = () => {
    if (!advice.pick) return
    setSelected(advice.pick)
    if (!list.some((e) => e.id === advice.pick)) setFilter('all')
    setHelpOpen(false)
  }
  const openHelp = (o: boolean) => {
    setHelpOpen(o)
    if (o) {
      setTime(null)
      setPain(null)
      setKit(null)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-4xl">Choose your exercise</h1>
            <p className="text-muted">Assigned exercises first. Camera coaching is on only where Praxis can verify the task.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill ariaLabel="Show" value={filter} onChange={setFilter} options={[{ value: 'assigned', label: 'Assigned' }, { value: 'all', label: 'All GRASP L2' }, { value: 'equipment', label: 'Equipment I have' }]} />
            {filter === 'equipment' && <Button variant="secondary" onClick={() => setKitOpen(true)}>What I have</Button>}
            <Button variant="secondary" onClick={() => openHelp(true)}>Help me choose</Button>
          </div>
        </div>

        {list.length === 0 && (
          <Card className="mt-5">
            <p className="text-xl">Nothing matches the equipment you have yet.</p>
            <Button variant="secondary" className="mt-3" onClick={() => setKitOpen(true)}>What I have</Button>
          </Card>
        )}
        <div className="mt-5 grid auto-rows-fr grid-cols-3 gap-4">
          {list.map((e) => {
            const on = e.id === selected
            return (
              <Card key={e.id} as="article" tone={on ? 'highlight' : 'default'} padding="none" className="flex flex-col">
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`Select ${e.name}`}
                  aria-describedby={`choose-${e.id}-details`}
                  onClick={() => setSelected(e.id)}
                  className="flex flex-1 flex-col rounded-t-[var(--r-card)] p-5 text-left transition-colors hover:bg-tint-mint focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--focus)]/40"
                >
                  <div className="flex w-full flex-wrap items-start justify-between gap-2">
                    <span className="text-base text-muted">{e.category}</span>
                    <span className="flex gap-2">
                      {ASSIGNED_TODAY.includes(e.id) && <Chip tone="focus">Today</Chip>}
                      <Chip tone={BADGE[e.kind].tone}>{BADGE[e.kind].text}</Chip>
                    </span>
                  </div>
                  <h2 className="mt-2 text-2xl">{e.name}</h2>
                  <div id={`choose-${e.id}-details`}>
                    <p className="mt-1">{e.equipment}</p>
                    <p>{e.dose}</p>
                    <p className="mt-1 text-muted">{e.note}</p>
                  </div>
                </button>
                <div className="flex items-center justify-between gap-3 px-5 pb-5">
                  <span className={`text-base font-bold ${on ? 'text-teal-ink' : 'text-muted'}`}>{on ? 'Selected' : 'Tap to select'}</span>
                  {e.kind === 'instructions' && <Button variant="secondary" onClick={() => setSheet(e)}>View instructions</Button>}
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      <FlowBar
        step={1}
        label="Choose"
        left={
          <>
            <span className="hidden self-center text-muted lg:inline">Level changes need your clinician.</span>
            <Button variant="secondary" onClick={() => nav('/details/checkin')}>Back</Button>
          </>
        }
        right={
          current.kind === 'instructions' ? (
            <Button onClick={() => setSheet(current)}>View instructions</Button>
          ) : (
            <Button onClick={begin} disabled={!currentVisible}>Begin setup</Button>
          )
        }
      />

      <Sheet open={!!sheet} onOpenChange={(o) => !o && setSheet(null)} title={sheet?.name ?? ''} description={sheet ? `${sheet.category} · ${sheet.equipment} · ${sheet.dose}. Instructions paraphrased from your program; no camera for this one.` : ''}>
        {sheet && (
          <>
            <ol className="mt-4 list-decimal space-y-2 pl-6 text-xl">{sheet.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            <p className="mt-4 text-muted">Logged from your own count: {logged[sheet.id] ?? 0} set{(logged[sheet.id] ?? 0) === 1 ? '' : 's'} today.</p>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setLogged((l) => ({ ...l, [sheet.id]: (l[sheet.id] ?? 0) + 1 }))}>Log 1 set</Button>
              <Button onClick={() => setSheet(null)}>Done</Button>
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={kitOpen} onOpenChange={setKitOpen} title="What I have" description="Tick what is within reach today. The list is kept on this device and drives the Equipment I have filter.">
        <div className="mt-4 grid grid-cols-2 gap-x-6">
          {EQUIPMENT.map((k) => (
            <Checkbox key={k.id} label={k.label} checked={owned.includes(k.id)} onChange={(v) => saveOwned(v ? [...owned, k.id] : owned.filter((o) => o !== k.id))} />
          ))}
        </div>
        <div className="mt-6 flex justify-end"><Button onClick={() => setKitOpen(false)}>Done</Button></div>
      </Sheet>

      <Sheet open={helpOpen} onOpenChange={openHelp} title="Help me choose" description="Three quick questions. The suggestion is rule-based and stays inside your assigned program.">
        <div className="mt-5 space-y-5">
          <div>
            <div className="mb-2 font-bold">How much time do you have?</div>
            <Pill ariaLabel="Time" value={time ?? ''} onChange={(v) => setTime(v as Time)} options={[{ value: '5', label: 'About 5 minutes' }, { value: '15', label: 'About 15 minutes' }]} />
          </div>
          <div>
            <div className="mb-2 font-bold">Any pain right now?</div>
            <Pill ariaLabel="Pain" value={pain ?? ''} onChange={(v) => setPain(v as Pain)} options={[{ value: 'none', label: 'None' }, { value: 'some', label: 'Some (under 5)' }, { value: 'high', label: '5 or more' }]} />
          </div>
          <div>
            <div className="mb-2 font-bold">Is the cup and the printed target sheet within reach?</div>
            <Pill ariaLabel="Equipment" value={kit ?? ''} onChange={(v) => setKit(v as HasKit)} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
          </div>
          <Card tone={advice.pick ? 'coach' : pain === 'high' ? 'watch' : 'default'} padding="sm">
            <p className="text-xl">{advice.why}</p>
          </Card>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => openHelp(false)}>Cancel</Button>
          <Button onClick={usePick} disabled={!advice.pick}>Use this pick</Button>
        </div>
      </Sheet>
    </div>
  )
}
