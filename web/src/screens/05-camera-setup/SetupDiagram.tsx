/** Camera placement diagrams for screen 05, one per view (own drawings, inline SVG, both
 *  themes via currentColor and the palette tokens). Mint marks the practising arm, amber the
 *  camera's line of sight. Each has a text alternative that says the same thing in words. */
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
      <Sight x1={216} y1={70} x2={68} y2={70} />
      <Tripod x={234} y={70} />
      <text x={234} y={52} fontSize={12} fill="currentColor" textAnchor="middle" fontFamily="inherit">chest height</text>
      <Dimension x1={56} x2={234} label="2–2.5 m" />
    </>
  )
}

/** Table (Waiter – cup, NHPT): a phone on a stand above the sheet, and what the picture shows. */
function Table() {
  return (
    <>
      <line x1={8} y1={128} x2={200} y2={128} {...S} />
      <rect x={58} y={118} width={96} height={10} rx={2} fill="var(--mint)" stroke="currentColor" strokeWidth={1.5} />
      <line x1={164} y1={128} x2={196} y2={128} {...S} />
      <line x1={180} y1={128} x2={180} y2={34} {...S} />
      <line x1={180} y1={34} x2={116} y2={34} {...S} />
      <rect x={92} y={26} width={40} height={16} rx={4} fill="var(--surface)" stroke="currentColor" strokeWidth={2.5} />
      <circle cx={106} cy={42} r={3} fill="currentColor" />
      <line x1={106} y1={48} x2={106} y2={112} stroke="var(--amber)" strokeWidth={2} strokeDasharray="4 4" />
      <polygon points="100,108 112,108 106,116" fill="var(--amber)" />
      <line x1={30} y1={40} x2={30} y2={122} {...THIN} />
      <line x1={24} y1={40} x2={36} y2={40} {...THIN} />
      <line x1={24} y1={122} x2={36} y2={122} {...THIN} />
      <text x={10} y={150} fontSize={13} fill="currentColor" fontFamily="inherit">45–60 cm</text>
      {/* what the camera sees: the sheet fills about two-thirds of the picture */}
      <rect x={214} y={46} width={60} height={45} rx={3} fill="none" stroke="currentColor" strokeWidth={2} />
      <rect x={221} y={51.5} width={46} height={34} rx={1.5} fill="var(--mint)" stroke="currentColor" strokeWidth={1.2} />
      <text x={244} y={108} fontSize={12} fill="currentColor" textAnchor="middle" fontFamily="inherit">the picture</text>
    </>
  )
}

const ALT: Record<string, string> = {
  side: 'Camera on a stand at seated shoulder height, 1.5 to 2 metres away, pointing at your practising side. A chair without arms so the camera can see your hip.',
  pendulum: 'Stand sideways to the camera with one hand on a table and the practising arm hanging. The camera sits lower, about table height, 1.5 to 2 metres away.',
  front: 'Camera centred at chest height, 2 to 2.5 metres in front of you, facing you.',
  table: 'A phone or webcam on a stand 45 to 60 centimetres above the table, pointing straight down. The sheet fills about two-thirds of the picture.',
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
      heading: 'Mount the camera above the table',
      body: 'Put the phone or webcam on a stand 45–60 cm up, pointing straight down, so the sheet fills about two-thirds of the picture. Looking across the table makes pegs and hands land in the wrong place; the check below measures the tilt.',
    }
  if (view === 'front')
    return {
      heading: 'Place the camera in front of you',
      body: 'Stand the camera 2–2.5 m in front of you, centred at chest height, so both hands fit when you lift your arms out to the side.',
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
