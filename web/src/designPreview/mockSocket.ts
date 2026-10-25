/** Design preview only: stands in for the session service's WebSocket (`/ws/session`).
 *
 *  Plays a recorded server -> client stream (`recordings.ts`) with its original timing. Frames
 *  the page sends are ignored (there is no camera and no service); text commands get the
 *  service's acknowledgement shape (`main.py _handle_command`): pause/resume hold and continue
 *  the recording, pain at the stop level ends it, `feedback` saves the session to the mock API
 *  so the report opens. When the recording ends the socket stays open, as the service's does,
 *  until the page closes it. */
import { savePreviewSession } from './mockApi'
import { loadRecording, recordingFor, type Recording } from './recordings'

const PAIN_STOP = 7 // seed prescription stop level (the mock API serves the same prescription)
let nextId = 9_000_000 // ids for events the mock makes up, far above the recorded ones

type Handler<E extends Event> = ((ev: E) => void) | null

export class PreviewSessionSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3

  readonly url: string
  readonly protocol = ''
  readonly extensions = ''
  binaryType: BinaryType = 'blob'
  bufferedAmount = 0
  readyState = 0
  onopen: Handler<Event> = null
  onclose: Handler<CloseEvent> = null
  onerror: Handler<Event> = null
  onmessage: Handler<MessageEvent> = null

  private rec: Recording | null = null
  private cursor = 0
  private clipMs = 0 // recording time already played
  private startedAt = 0 // wall time the current run started (performance.now)
  private running = false
  private stopped = false
  private stop: { t: number; rule: string; detail: string } | null = null
  private timer: number | null = null
  private lastT = 0
  // What the recordings were made with; a check-in the page sends replaces it.
  private checkin: Record<string, unknown> = { pain_before: 2, energy: 'ok', minutes: 10, new_symptoms: false }

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    const q = new URL(this.url, location.href).searchParams
    const key = recordingFor(q)
    window.setTimeout(() => {
      if (this.readyState !== 0) return
      if (q.get('tier') === 'rest') return this.refuse({ type: 'error', code: 'rest_day', tier: 'rest' })
      if (!key) return this.refuse({ type: 'error', code: 'bad_mode', mode: q.get('mode') })
      loadRecording(key).then(
        (rec) => {
          if (this.readyState !== 0) return
          this.rec = rec
          this.readyState = 1
          this.fire('open', new Event('open'))
          this.play()
        },
        () => this.fail(),
      )
    }, 120)
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.readyState !== 1) return
    if (typeof data !== 'string') return // a camera frame: nothing to process in the preview
    let cmd: Record<string, unknown> = {}
    try {
      cmd = JSON.parse(data) as Record<string, unknown>
    } catch {
      /* the service treats a bad command as {} */
    }
    window.setTimeout(() => this.command(cmd), 30)
  }

  close() {
    if (this.readyState >= 2) return
    this.halt()
    this.readyState = 3
    this.fire('close', new CloseEvent('close', { code: 1000, wasClean: true }))
  }

  // ---- playback ------------------------------------------------------------------------------
  private play() {
    if (this.running || this.stopped || !this.rec) return
    this.running = true
    this.startedAt = performance.now()
    this.tick()
  }

  private halt() {
    if (this.running) this.clipMs += performance.now() - this.startedAt
    this.running = false
    if (this.timer != null) window.clearTimeout(this.timer)
    this.timer = null
  }

  private tick() {
    if (!this.running || !this.rec) return
    const msgs = this.rec.messages
    const now = this.clipMs + (performance.now() - this.startedAt)
    while (this.cursor < msgs.length && msgs[this.cursor].at <= now) this.deliver(msgs[this.cursor++].msg)
    if (this.cursor >= msgs.length) {
      this.halt() // recording done; stay open for feedback, like the service
      return
    }
    this.timer = window.setTimeout(() => this.tick(), Math.max(0, Math.min(250, msgs[this.cursor].at - now)))
  }

  private deliver(msg: Record<string, unknown>) {
    if (this.readyState !== 1) return
    if (typeof msg.t === 'number') this.lastT = msg.t
    this.fire('message', new MessageEvent('message', { data: JSON.stringify(msg) }))
  }

  private event(type: string, payload: Record<string, unknown> = {}) {
    return { type, t: this.lastT, id: nextId++, ...payload }
  }

  // ---- commands (shapes from the service's _handle_command) ----------------------------------
  private command(cmd: Record<string, unknown>) {
    if (this.readyState !== 1 || !this.rec) return
    const name = cmd.cmd
    const sid = this.rec.session_id
    const ack = (extra: Record<string, unknown> = {}) => this.deliver(this.event('command', { cmd: name, ok: true, session_id: sid, ...extra }))
    if (this.rec.mode === 'calibrate') return this.deliver(this.event('command', { cmd: name, ok: false, error: 'no pipeline' }))
    switch (name) {
      case 'checkin':
        // The recording already carries the service's reply to a pain-2 check-in; the stored
        // check-in is kept for the saved session only.
        this.checkin = { pain_before: cmd.pain ?? 0, energy: cmd.energy ?? '', minutes: cmd.minutes ?? 0, new_symptoms: !!cmd.new_symptoms }
        return
      case 'pause':
        this.halt()
        ack()
        return this.deliver(this.event('pause', { rule: 'patient', text: 'Paused. Take your time.' }))
      case 'resume':
        ack()
        this.deliver(this.event('resume'))
        return this.play()
      case 'pain': {
        const pain = Number(cmd.pain ?? 0)
        ack()
        if (pain >= PAIN_STOP && !this.stopped) {
          this.halt()
          this.stopped = true
          this.deliver(this.event('stop', { rule: 'pain', pain, text: `Pain ${pain}/10 is at or above your stop level. Session ended and saved; your therapist is flagged.` }))
          this.stop = { t: this.lastT, rule: 'pain', detail: `pain ${pain}/10 reported (stop level ${PAIN_STOP})` }
          this.deliver(this.event('therapist_flag', { rule: 'pain', detail: this.stop.detail }))
        }
        return
      }
      case 'answer': {
        const yes = String(cmd.choice ?? '').toLowerCase().startsWith('yes')
        ack()
        const text = yes ? 'Fast arcs on. Same path, quicker — still one dot at a time.' : 'Keeping the slow pace. That\'s fine.'
        return this.deliver(this.event('coach', { action: yes ? 'progress' : 'instruct', cue_id: yes ? 'cup_fast' : 'keep_pace', text, reason: yes ? 'patient accepted progression' : 'patient declined progression', evidence: [], ui: yes ? { avatar_clip: 'cup' } : {}, label: 'Rule-based coach · LLM agent pending', tool_calls: [], source: 'rule' }))
      }
      case 'feedback': {
        const feedback = { ...cmd }
        delete feedback.cmd
        const summary = savePreviewSession(this.rec, feedback, this.stop, this.checkin)
        return ack({ summary })
      }
      default:
        return ack()
    }
  }

  // ---- plumbing ------------------------------------------------------------------------------
  private fire(type: string, ev: Event) {
    const h = (this as unknown as Record<string, unknown>)[`on${type}`]
    if (typeof h === 'function') (h as (e: Event) => void).call(this, ev)
    this.dispatchEvent(ev)
  }

  private refuse(msg: Record<string, unknown>) {
    this.readyState = 1
    this.fire('open', new Event('open'))
    this.deliver({ ...msg, t: 0, id: nextId++ })
    this.close()
  }

  private fail() {
    this.fire('error', new Event('error'))
    this.close()
  }
}
