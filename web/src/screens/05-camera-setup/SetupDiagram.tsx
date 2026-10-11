/** Camera placement diagrams for screen 05, one per view (own drawings, inline SVG, both
 *  themes via currentColor and the palette tokens). Mint marks the practising arm and the sheet,
 *  amber the camera's line of sight. Each has a text alternative that says the same thing in
 *  words. Since 10 Oct 2026 the only camera is the laptop's built-in one (product owner): the
 *  front view puts the laptop on a table facing the patient, the table view tilts its screen
 *  forward over the sheet. The dormant side views (hidden 28 Sep) keep their tripod drawing. */
import type { SetupView } from './setupView'

const S = { stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' as const, fill: 'none' }
const THIN = { stroke: 'currentColor', strokeWidth: 1.5 }

function Tripod({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <line x1={x - 12} y1={146} x2={x} y2={y + 8} {...S} strokeWidth={2.5} />
      <line x1={x + 12} y1={146} x2={x} y2={y + 8} {...S} strokeWidth={2.5} />
      <line x1={x} y1={146} x2={x} y2={y + 8} {...S} strokeWidth={2.5} />
      <rect x={x - 14} y={y - 7} width={28} height={14} rx={3} fill="var(--surface)" stroke="currentColor" strokeWidth={2.5} />
      <circle cx={x - 14} cy={y} r={4} fill="currentColor" />
    </g>
  )
}

/** A laptop in profile, keyboard towards the left (the patient), hinge on the right. `tilt` is
 *  how far the screen leans forward past upright, in degrees; the lens sits at the screen's top
 *  edge. Returns the drawing and where the lens is, for the line of sight. */
function laptop(hingeX: number, baseY: number, tilt: number, screen = 64, depth = 58) {
  const r = (tilt * Math.PI) / 180
  const topX = hingeX - screen * Math.sin(r)
  const topY = baseY - screen * Math.cos(r)
  const lens = { x: topX - 4 * Math.cos(r) + 3 * Math.sin(r), y: topY + 4 * Math.sin(r) + 3 * Math.cos(r) }
  const g = (
    <g>
      <rect x={hingeX - depth} y={baseY} width={depth + 2} height={6} rx={2} fill="var(--surface)" stroke="currentColor" strokeWidth={2.5} />
      <line x1={hingeX} y1={baseY + 1} x2={topX} y2={topY} {...S} strokeWidth={6} />
      <line x1={hingeX} y1={baseY + 1} x2={topX} y2={topY} stroke="var(--surface)" strokeWidth={2} strokeLinecap="round" />
      <circle cx={lens.x} cy={lens.y} r={3} fill="currentColor" />
    </g>
  )
  return { g, lens }
}

function Dimension({ x1, x2, label }: { x1: number; x2: number; label: string }) {
  const mid = (x1 + x2) / 2
  return (
    <g>
      <line x1={x1} y1={164} x2={x2} y2={164} {...THIN} />
      <line x1={x1} y1={158} x2={x1} y2={170} {...THIN} />
      <line x1={x2} y1={158} x2={x2} y2={170} {...THIN} />
      <rect x={mid - 30} y={155} width={60} height={16} fill="var(--surface)" />
      <text x={mid} y={168} fontSize={13} fill="currentColor" textAnchor="middle" fontFamily="inherit">{label}</text>
    </g>
  )
}

function Sight({ x1, x2, y1, y2 }: { x1: number; x2: number; y1: number; y2: number }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--amber)" strokeWidth={2} strokeDasharray="5 4" />
}

const floor = <line x1={8} y1={146} x2={272} y2={146} {...S} />

/** Side view (Arm to the front): the reader faces the patient; the camera looks at their side. */
function SideSeated() {
  return (
    <>
      {floor}
      {/* armless chair, seen from the front */}
      <rect x={42} y={100} width={56} height={7} rx={2} fill="var(--surface)" stroke="currentColor" strokeWidth={2} />
      <line x1={46} y1={107} x2={46} y2={146} {...S} strokeWidth={2} />
      <line x1={94} y1={107} x2={94} y2={146} {...S} strokeWidth={2} />
      {/* patient */}
      <circle cx={70} cy={40} r={11} fill="var(--surface)" stroke="currentColor" strokeWidth={2.5} />
      <line x1={70} y1={51} x2={70} y2={98} {...S} />
      <line x1={54} y1={60} x2={86} y2={60} {...S} />
      <line x1={54} y1={60} x2={50} y2={98} {...S} />
      <line x1={86} y1={60} x2={90} y2={98} stroke="var(--mint)" strokeWidth={5} strokeLinecap="round" />
      <line x1={60} y1={99} x2={80} y2={99} {...S} />
      <line x1={62} y1={100} x2={62} y2={146} {...S} />
      <line x1={78} y1={100} x2={78} y2={146} {...S} />
      <Sight x1={212} y1={62} x2={96} y2={62} />
      <Tripod x={230} y={62} />
      <text x={230} y={44} fontSize={12} fill="currentColor" textAnchor="middle" fontFamily="inherit">shoulder height</text>
      <Dimension x1={70} x2={230} label="1.5–2 m" />
    </>
  )
}

/** Pendulum: standing, one hand on a table, the practising arm hanging; camera low at the side. */
function SidePendulum() {
  return (
    <>
      {floor}
      {/* table */}
      <line x1={12} y1={92} x2={70} y2={92} {...S} />
      <line x1={18} y1={92} x2={18} y2={146} {...S} strokeWidth={2} />
      <line x1={64} y1={92} x2={64} y2={146} {...S} strokeWidth={2} />
      {/* patient leaning forward */}
      <line x1={110} y1={146} x2={113} y2={100} {...S} />
      <line x1={124} y1={146} x2={115} y2={100} {...S} />
      <line x1={114} y1={100} x2={82} y2={72} {...S} />
      <circle cx={72} cy={62} r={10} fill="var(--surface)" stroke="currentColor" strokeWidth={2.5} />
      <line x1={82} y1={72} x2={58} y2={91} {...S} />
      <line x1={82} y1={72} x2={86} y2={120} stroke="var(--mint)" strokeWidth={5} strokeLinecap="round" />
      <path d="M74 116 Q86 128 98 116" fill="none" stroke="var(--mint)" strokeWidth={2} strokeDasharray="3 3" />
      <Sight x1={222} y1={96} x2={96} y2={104} />
      <Tripod x={240} y={96} />
      <text x={240} y={78} fontSize={12} fill="currentColor" textAnchor="middle" fontFamily="inherit">table height</text>
      <Dimension x1={86} x2={240} label="1.5–2 m" />
    </>
  )
}

/** Front view (Arm out to the side): seen from the side, the patient faces the camera. */
function Front() {
  return (
    <>
      {floor}
      {/* chair in profile */}
      <line x1={36} y1={100} x2={80} y2={100} {...S} strokeWidth={2.5} />
      <line x1={36} y1={100} x2={36} y2={62} {...S} strokeWidth={2.5} />
      <line x1={38} y1={100} x2={38} y2={146} {...S} strokeWidth={2} />
      <line x1={78} y1={100} x2={78} y2={146} {...S} strokeWidth={2} />
      {/* patient facing right */}
      <circle cx={56} cy={42} r={11} fill="var(--surface)" stroke="currentColor" strokeWidth={2.5} />
      <line x1={56} y1={53} x2={56} y2={97} {...S} />
      <line x1={56} y1={97} x2={92} y2={99} {...S} />
      <line x1={92} y1={99} x2={92} y2={146} {...S} />
      <line x1={57} y1={60} x2={62} y2={94} stroke="var(--mint)" strokeWidth={5} strokeLinecap="round" />
      <FrontLaptop />
      <Dimension x1={56} x2={234} label="2–2.5 m" />
    </>
  )
}

/** The laptop on a table in front of the patient, screen upright, lens at about chest height. */
function FrontLaptop() {
  const { g, lens } = laptop(254, 98, 4, 30, 40)
  return (
    <g>
      <line x1={204} y1={104} x2={270} y2={104} {...S} />
      <line x1={210} y1={104} x2={210} y2={146} {...S} strokeWidth={2} />
      <line x1={264} y1={104} x2={264} y2={146} {...S} strokeWidth={2} />
      <Sight x1={lens.x - 6} y1={lens.y} x2={68} y2={lens.y} />
      {g}
      <text x={234} y={52} fontSize={12} fill="currentColor" textAnchor="middle" fontFamily="inherit">chest height</text>
    </g>
  )
}

/** Table (Waiter – cup, NHPT): the laptop on the table with its screen tilted forward, the sheet
 *  flat in front of it (between laptop and patient) and the camera's view reaching the sheet. */
function Table() {
  const sheet = { x1: 94, x2: 152 }
  const front = 194
  const { g, lens } = laptop(238, 114, 24, 82, 44)
  return (
    <>
      {/* table */}
      <line x1={8} y1={120} x2={272} y2={120} {...S} />
      <line x1={20} y1={120} x2={20} y2={146} {...S} strokeWidth={2} />
      <line x1={260} y1={120} x2={260} y2={146} {...S} strokeWidth={2} />
      {/* what the camera sees: a cone from the lens down to the whole sheet */}
      <polygon points={`${lens.x},${lens.y} ${sheet.x1},116 ${sheet.x2},116`} fill="var(--amber)" opacity={0.14} />
      <Sight x1={lens.x} y1={lens.y} x2={sheet.x1} y2={116} />
      <Sight x1={lens.x} y1={lens.y} x2={sheet.x2} y2={116} />
      {/* the printed sheet, flat */}
      <rect x={sheet.x1} y={116} width={sheet.x2 - sheet.x1} height={4} rx={1} fill="var(--mint)" stroke="currentColor" strokeWidth={1.5} />
      {g}
      <text x={lens.x} y={lens.y - 12} fontSize={12} fill="currentColor" textAnchor="middle" fontFamily="inherit">laptop camera</text>
      <text x={sheet.x1 + (sheet.x2 - sheet.x1) / 2} y={136} fontSize={12} fill="currentColor" textAnchor="middle" fontFamily="inherit">sheet</text>
      <text x={14} y={112} fontSize={12} fill="currentColor" fontFamily="inherit">you</text>
      <Dimension x1={(sheet.x1 + sheet.x2) / 2} x2={front} label="25–35 cm" />
    </>
  )
}

const ALT: Record<string, string> = {
  side: 'Camera at seated shoulder height, 1.5 to 2 metres away, pointing at your practising side. A chair without arms so the camera can see your hip.',
  pendulum: 'Stand sideways to the camera with one hand on a table and the practising arm hanging. The camera sits lower, about table height, 1.5 to 2 metres away.',
  front: 'Laptop on a table at about your chest height when seated, 2 to 2.5 metres in front of you, its camera facing you.',
  table: 'Laptop on the table with its screen tilted forward, and the printed sheet flat on the table 25 to 35 centimetres in front of the laptop, between the laptop and you. The camera looks down at the whole sheet.',
}

export function SetupDiagram({ view, pendulum = false }: { view: SetupView; pendulum?: boolean }) {
  const key = view === 'side' && pendulum ? 'pendulum' : view
  return (
    <svg role="img" aria-label={ALT[key]} viewBox="0 0 280 176" className="h-auto w-full max-w-64 shrink-0">
      {key === 'side' && <SideSeated />}
      {key === 'pendulum' && <SidePendulum />}
      {key === 'front' && <Front />}
      {key === 'table' && <Table />}
    </svg>
  )
}

/** Heading and one plain paragraph per view. */
export function placementCopy(view: SetupView, side: string, pendulum: boolean): { heading: string; body: string } {
  if (view === 'table')
    return {
      heading: 'Tilt your laptop over the sheet',
      body: 'Put the laptop on the table and lay the sheet flat 25–35 cm in front of it, between the laptop and you. Then tilt the screen forward until the whole sheet shows, so the camera looks down at it. Your face does not need to be in the picture. If the camera looks too flat across the table, pegs hide the next hole; the check below measures the angle.',
    }
  if (view === 'front')
    return {
      heading: 'Place the camera in front of you',
      body: 'Put your laptop on a table at about your chest height when seated, and sit 2–2.5 m back facing it, so your head, both shoulders, both hands and your hips fit when you lift your arms out to the side. Your face is never analysed, but the camera finds you by your head.',
    }
  if (pendulum)
    return {
      heading: 'Place the camera low, beside you',
      body: `Stand sideways with your ${side} side to the camera and your other hand on a table. Put the camera lower, about table height, 1.5–2 m away, so the swinging arm stays in the picture.`,
    }
  return {
    heading: 'Place the camera beside you',
    body: `Stand the camera 1.5–2 m away at your shoulder height when seated, with your ${side} side square to the lens. Use a chair without arms so your hip shows.`,
  }
}

export const SETUP_TIPS = 'Light from the front, no window behind you. Fitted short sleeves help the camera see your elbow and wrist.'
