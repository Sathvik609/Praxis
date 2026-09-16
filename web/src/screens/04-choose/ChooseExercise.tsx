import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlowBar } from '../../app/FlowBar'
import { Button } from '../../design/Button'
import { Chip } from '../../design/Chip'
import { Overlay } from '../../design/Overlay'
import { EXERCISES, type Exercise } from '../../lib/seed'

const BADGE: Record<Exercise['kind'], { tone: 'neutral' | 'mint'; text: string }> = {
  assessment: { tone: 'neutral', text: 'Assessment' },
  camera: { tone: 'mint', text: 'Camera coached' },
  instructions: { tone: 'neutral', text: 'Instructions only' },
}

/** Screen 04 · Choose exercise. Assigned first; only validated tasks get Begin setup. */
export function ChooseExercise() {
  const nav = useNavigate()
  const [filter, setFilter] = useState<'assigned' | 'all' | 'equipment'>('assigned')
  const [sheet, setSheet] = useState<Exercise | null>(null)
  const [logged, setLogged] = useState(0)
  const side = (() => {
    try {
      return JSON.parse(sessionStorage.getItem('praxis.profile') ?? '{}').side ?? 'left'
    } catch {
      return 'left'
    }
  })()
  const list = filter === 'all' ? EXERCISES : filter === 'equipment' ? EXERCISES.filter((e) => e.kind !== 'instructions' || e.id === 'blocks') : EXERCISES
  const tab = (v: typeof filter, label: string) => (
    <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)} className={`min-h-14 rounded-full border-2 px-5 text-lg font-bold ${filter === v ? 'border-teal bg-teal text-white' : 'border-line bg-surface'}`}>{label}</button>
  )
  return (
    <div className="flex min-h-[calc(100vh-5rem)] flex-col">
      <div className="flex-1 p-8">
        <div className="flex items-start gap-4">
          <div><h1 className="text-5xl">Choose your exercise</h1><p className="text-muted">Assigned exercises first. Camera coaching is on only where Praxis can verify the task.</p></div>
          <div className="ml-auto flex gap-2">{tab('assigned', 'Assigned')}{tab('all', 'All GRASP L2')}{tab('equipment', 'Equipment I have')}<Button variant="secondary" onClick={() => nav('/coach')}>Help me choose</Button></div>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-5">
          {list.map((e) => (
            <div key={e.id} className="flex flex-col rounded-2xl border border-line bg-surface p-6">
              <div className="flex items-start justify-between gap-2"><span className="text-muted">{e.category}</span><Chip tone={BADGE[e.kind].tone}>{BADGE[e.kind].text}</Chip></div>
              <h2 className="mt-2 text-3xl">{e.name}</h2>
              <p className="mt-1">{e.equipment}</p>
              <p>{e.dose}</p>
              <p className="mt-1 text-muted">{e.note}</p>
              <div className="mt-auto pt-5">
                {e.kind === 'instructions' ? (
                  <Button variant="secondary" onClick={() => setSheet(e)}>View instructions</Button>
                ) : (
                  <Button onClick={() => nav(`/setup?exercise=${e.id}&side=${side}`)}>Begin setup</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <FlowBar step={1} label="Choose" left={<span className="self-center text-muted">Level changes need your clinician.</span>} right={<Button variant="secondary" onClick={() => nav('/checkin')}>Back</Button>} />
      <Overlay open={!!sheet} title={sheet?.name ?? ''}>
        {sheet && (
          <>
            <p className="text-muted">{sheet.category} · {sheet.equipment} · {sheet.dose}. Instructions paraphrased from your program; no camera for this one.</p>
            <ol className="mt-4 list-decimal space-y-2 pl-6 text-xl">{sheet.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            <p className="mt-4 text-muted">Logged from your own count: {logged} set{logged === 1 ? '' : 's'} today.</p>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setLogged((n) => n + 1)}>Log 1 set</Button>
              <Button onClick={() => setSheet(null)}>Done</Button>
            </div>
          </>
        )}
      </Overlay>
    </div>
  )
}
