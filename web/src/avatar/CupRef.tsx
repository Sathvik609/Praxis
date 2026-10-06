import { useEffect, useMemo, useRef } from 'react'
import { prefersReducedMotion } from '../lib/motion'
import { AvatarPanel, type AvatarCtl } from './AvatarPanel'
import type { GlbActionMeta } from './glbActions'
import type { Projection } from './scene'

/** Reference figure of the live Waiter – cup screen (07b), as the designers' 6 Oct artifact
 *  draws it: the cup GLB scrubbed to the window that lands the cup on the next dot, the five
 *  sheet dots in their states and a dashed path from the cup to the next dot. Never a mirror of
 *  the patient and never a scorer.
 *
 *  Wiring (design v2 port): the target and dot states come from the service's cup events
 *  (`cupDots`, `frame.cup.expected_next`); `idle` while a hold is open or the exercise is done,
 *  `dim` while tracking is lost or right after a wrong dot, `point` otherwise. The artifact's
 *  `demo` pass has no event behind it and is not ported. */

export type CupRefMode = 'idle' | 'dim' | 'point'
export type CupRefTarget = { k: number; dir: 'across' | 'back' }
type DotState = 'done' | 'amber' | 'next' | 'todo'

type St = { t: number; from: number; to: number; t0: number; dur: number; mode: CupRefMode; moving: boolean }
type Svg = { root?: SVGSVGElement | null; path?: SVGPathElement | null; cue?: SVGPolylineElement | null } & Record<string, SVGElement | null | undefined>

/** The action time window (s) that lands the cup on dot `k` (0-based) going `dir`. */
function windowFor(am: GlbActionMeta | null | undefined, target: CupRefTarget): [number, number] {
  const lands = (am?.targets ?? []).filter((x) => x.landed)
  const dot = target.k + 1
  if (target.dir === 'across') {
    if (dot === 1) return [0.2, 1.7]
    const l = lands.find((x) => x.index === dot)
    return l ? [l.t - 1.2, l.t] : [0.6, 0.6]
  }
  const occ = lands.filter((x) => x.index === dot)
  const l = occ[occ.length - 1]
  return l ? [l.t - 1.2, l.t] : [0.6, 0.6]
}

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)
const JOINTS = ['lShoulder', 'lElbow', 'lWrist', 'rShoulder', 'rElbow', 'rWrist', 'dot1', 'dot2', 'dot3', 'dot4', 'dot5', 'cup']

export function CupRef({ side, target, dots, mode, label, pace = 'slow' }: { side: 'left' | 'right'; target: CupRefTarget | null; dots: DotState[]; mode: CupRefMode; label: string; pace?: 'slow' | 'fast' }) {
  const ctl = useRef<AvatarCtl | null>(null)
  const svg = useRef<Svg>({})
  // the figure faces the patient: their left arm is the figure's right
  const avSide = side === 'left' ? 'right' : 'left'
  const st = useRef<St>({ t: 0.6, from: 0.6, to: 0.6, t0: 0, dur: 0, mode: 'idle', moving: false })
  const live = useRef({ target, dots })
  useEffect(() => {
    live.current = { target, dots }
  })
  const reduced = useMemo(() => prefersReducedMotion(), [])
  const refKey = target ? `${target.k}-${target.dir}` : 'none'

  useEffect(() => {
    const r = st.current
    const am = ctl.current?.am
    r.mode = mode
    if (mode === 'point' && target) {
      const [a, b] = windowFor(am, target)
      r.from = a
      r.to = b
      r.t0 = performance.now()
      r.dur = reduced ? 1 : pace === 'fast' ? 900 : 1300
    } else if (mode === 'idle') {
      r.from = r.t
      r.to = 0.4
      r.t0 = performance.now()
      r.dur = 700
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refKey, mode, reduced])

  useEffect(() => {
    let raf = 0
    const step = (now: number) => {
      raf = requestAnimationFrame(step)
      const c = ctl.current
      const r = st.current
      if (!c?.clock) return
      if (r.mode !== 'dim') {
        const k = r.dur > 0 ? Math.min(1, (now - r.t0) / r.dur) : 1
        r.t = r.from + (r.to - r.from) * ease(k)
        r.moving = k < 1 && r.mode !== 'idle'
      } else r.moving = false
      c.clock.current.target = r.t
      c.clock.current.time = r.t
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [reduced])

  const drawOv = (j: Projection) => {
    const g = svg.current
    const r = st.current
    const cur = live.current
    if (!j || !g.root) return
    for (let i = 0; i < 5; i++) {
      const el = g['d' + i]
      const p = j['dot' + (i + 1)]
      if (!el || !p) continue
      el.setAttribute('cx', String(p.x))
      el.setAttribute('cy', String(p.y))
      const state = r.mode === 'idle' ? 'todo' : (cur.dots[i] ?? 'todo')
      el.setAttribute('class', `cupr-dot cupr-dot-${state}`)
    }
    const mv = avSide === 'right' ? 'r' : 'l'
    const Sh = j[mv + 'Shoulder']
    const E = j[mv + 'Elbow']
    const W = j[mv + 'Wrist']
    if (Sh && E && W && g.cue) {
      g.cue.setAttribute('points', `${Sh.x},${Sh.y} ${E.x},${E.y} ${W.x},${W.y}`)
      g.cue.style.opacity = r.moving && r.mode !== 'dim' ? '1' : '0'
    }
    const cupP = j.cup
    const np = cur.target ? j['dot' + (cur.target.k + 1)] : null
    if (!g.path) return
    if (cupP && np && r.mode === 'point') {
      g.path.setAttribute('d', `M ${cupP.x} ${cupP.y} Q ${(cupP.x + np.x) / 2} ${Math.min(cupP.y, np.y) - 26} ${np.x} ${np.y}`)
      g.path.style.opacity = '1'
    } else g.path.style.opacity = '0'
  }
  const jl = useMemo(() => JOINTS, [])
  const dimmed = mode === 'dim'
  const idle = mode === 'idle'

  return (
    <section className={`sx-panel sx-ref av-ref cupr ${dimmed ? 'av-dim' : ''} ${idle ? 'av-idle' : ''}`} aria-label="Reference figure">
      <div className="sx-ref-stage">
        <AvatarPanel bare overlayTop={40} clip="cup" camera="front" side={avSide} patientSide={side} onJoints={drawOv} jointList={jl} ctlRef={ctl} />
        <svg className="av-ov cupr-ov" aria-hidden ref={(el) => { svg.current.root = el }}>
          <path className="cupr-path" ref={(el) => { svg.current.path = el }} />
          <polyline className="av-cue" ref={(el) => { svg.current.cue = el }} />
          {[0, 1, 2, 3, 4].map((i) => (
            <circle key={i} r={7} className="cupr-dot" ref={(el) => { svg.current['d' + i] = el }} />
          ))}
        </svg>
      </div>
      <div className="sx-tag sx-tag-quiet">{`Reference · ${label}`}</div>
    </section>
  )
}
