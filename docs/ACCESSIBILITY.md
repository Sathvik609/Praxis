# Accessibility audit (WCAG 2.1 AA) — 10 Oct 2026, updated 21 Oct 2026

Target: WCAG 2.1 level AA plus keyboard and screen-reader usability on every screen of the web app, without changing the designers' look (design v2, 6 Oct). This file says what was checked, what was found and fixed, what is excepted by product decision and what is still not served. Every check below is a test or script in the repo, so the numbers can be regenerated.

## 1. How it was checked

| Check | Tool | Where | Runs in CI |
|---|---|---|---|
| Automated WCAG 2.0/2.1 A + AA rules, plus heading order, landmarks, ARIA role rules | axe-core 4.13.0 (MPL-2.0, dev only, pinned) in jsdom | `web/src/test/axe.ts`, `web/src/a11y/*.a11y.test.tsx` | yes (vitest) |
| One `main` and one level-1 heading per page (axe leaves these "incomplete" in jsdom) | Testing Library role queries | `expectPageStructure()` in `web/src/test/axe.ts` | yes |
| Colour contrast on the rendered pages, light and dark, 1280 × 800 | axe-core 4.13.0 in headless Chrome over the design preview (DevTools protocol, no extra dependency) | `web/scripts/a11y-browser.mjs` | no (needs Chrome): `pnpm build:design && node scripts/a11y-browser.mjs` |
| Contrast of every token pair, both themes | WCAG formula on `tokens.css` | `web/src/design/contrast.test.ts` | yes |
| Keyboard: Tab reachability, Enter / Space / arrows, focus trap, Escape, focus return | `@testing-library/user-event` (`user.tab()`, `user.keyboard()`) | `web/src/a11y/keyboard.a11y.test.tsx`, `dialogs.a11y.test.tsx` | yes |
| Live regions (one polite announcer per live screen, counters not live) | DOM queries | `screens.a11y.test.tsx` | yes |
| Reduced motion and flashing | DOM + a source scan of the stylesheets | `motion.a11y.test.tsx`, `flash.a11y.test.ts` | yes |

The screens are rendered through the real route table with the design preview's captured service data (`designPreview/mockApi.ts`); Camera setup and the live screens are fed recorded event streams (`designPreview/fixtures/ws/*.json`) through the webcam hook (`a11y/harness.tsx`). In jsdom, `color-contrast` is the only axe rule turned off, because jsdom has no layout and the test run loads no CSS; contrast is checked by the token test and by the Chrome pass instead.

Not done: no session with a real screen reader (VoiceOver, NVDA, JAWS) or switch device, and no test with patients who use assistive technology. The checks above are automated and role-based.

## 2. Screens and states covered

| Screen | axe (jsdom) | axe in Chrome (light / dark) | Keyboard |
|---|---|---|---|
| 02 Home `/details` | ✓ | ✓ / ✓ | area tabs with arrows |
| 03 Check-in | ✓ | ✓ / ✓ | critical path |
| 04 Choose exercise (+ Exercises hub) | ✓ | ✓ / ✓ | critical path |
| 06 Demonstration (cup, arm) + "Before you start" | ✓ | ✓ / ✓ | critical path |
| 05 Camera setup (NHPT, cup, arm) | ✓ | open finding / ✓ | critical path |
| 07b Live Waiter – cup (live, replay) | ✓ | ✓ / ✓ | critical path |
| 07 Live NHPT (live, replay board view) | ✓ | ✓ / ✓ (after fix) | — |
| 07c Live Arm out to the side | ✓ | ✓ / ✓ | — |
| 08 Post-session feedback | ✓ | — | critical path |
| 09 Session report `/report/<id>` (cup + arm, NHPT) + assessment result | ✓ | ✓ / ✓ | critical path (arrival) |
| 10 Progress | ✓ | ✓ / ✓ | — |
| Calendar | ✓ | open finding / open finding | — |
| Settings (+ Replay picker) | ✓ | ✓ / ✓ | Replay picker |
| 11 Therapist (+ Edit practice days) | ✓ | ✓ / open finding | dialog Escape |
| Coach chat drawer (deep link and from Choose) | ✓ | ✓ / ✓ | — |
| Dialogs and in-session states: Pain / feel unwell, End session, stop rule, tracking lost, resting, progression prompt ("Ready to go faster?"), cup done, set check-in | ✓ (each) | — | each (see §3) |

**Keyboard critical path** (`keyboard.a11y.test.tsx`, keyboard only, the test never clicks or focuses): Skip to main content → pain 0 on the check-in scale → Left arm → Continue to exercises → Exercises (hub nav) → Start session: Waiter – cup → "Before you start" (focus lands on Continue to setup) → Camera setup Continue → live session → Pain / feel unwell (scale with arrows, Send to coach, focus back on the bar) → End session (reason with Space, End session) → feedback (Next … Save and see report) → report.

## 3. Results

### Found and fixed

| # | Where | Finding | Fix (no visual change unless noted) |
|---|---|---|---|
| 1 | Demonstration, Camera setup | A second `main` nested in the Shell's `main` (axe: landmark-main-is-top-level, landmark-no-duplicate-main, landmark-unique) | Inner element is a `div` (same classes) |
| 2 | Therapist | No `main` landmark; all content outside landmarks (axe: region) | `role="main"` on the grid |
| 3 | Choose exercise | Card titles were `h3` straight after the `h1` (heading-order) | `h2` (same classes) |
| 4 | Home | Week dots: `aria-label` on a role-less `span` (aria-prohibited-attr) | `role="img"` |
| 5 | Live Arm | Reference rep ticks: same | `role="img"` |
| 6 | Live NHPT replay | Board holes: same, ×9 (found only by the Chrome pass; the jsdom sweep now covers replay screens) | `role="img"` in a `role="group"` named "board view" |
| 7 | Live screens | No level-1 heading | Header title is `role="heading" aria-level="1"` (a role, so designer.css's `h1` rules do not restyle it) |
| 8 | All Radix dialogs | Focus went to the page on close: Radix returns focus only to a `Dialog.Trigger`, and Praxis opens dialogs from ordinary buttons | `useReturnFocus()` on Overlay, Choose sheets, coach chat |
| 9 | End session, progression prompt, cup done, Before you start (hand-built `aria-modal` dialogs) | No focus trap; focus not returned on close | `useModalFocus()`: focus in on open, Tab cycles inside, focus back to the opener; Escape where there is a cancel |
| 10 | Tracking lost / pause / resting hold | Focus moved in but was dropped on close | Same hook, non-modal (the control bar stays usable) |
| 11 | Pain / feel unwell | Escape did nothing | Escape = Back to session; a stray backdrop tap still does not dismiss it |
| 12 | Stop-rule overlay | Announced as an ordinary dialog | `role="alertdialog"` (also for a perception pause shown there) |
| 13 | End reasons, feedback choices, Settings theme, Choose filters, Home area tabs | Radio groups and tabs built from buttons had no arrow keys | `arrowSelect`: arrows / Home / End move and select; every option is still a Tab stop with Enter / Space |
| 14 | Home | The whole area card was a polite live region (every tab change read the card) | The card is the tabs' `tabpanel` (`aria-controls`), not live |
| 15 | Live header | "Coach is thinking…" was announced on every agent run, then the caption | Shown, not announced; "Coach offline · rule coach" is still announced |
| 16 | Patient shell | No bypass for the nine header controls (2.4.1) | "Skip to main content" link, off screen until focused (index.css `.ui-skip`) |
| 17 | Controls with no designer focus style | Browser default focus ring | `:focus-visible` ring in the focus token (`--focus`) in the CSS base layer, so every designer and Tailwind focus rule still wins |
| 18 | Home and Demonstration figures | Played on their own under reduced motion | Wait for Play when Settings › Reduced motion or the system setting is on (visual change only for those users, as Settings promises) |

### Kept by product decision (D-CONTRAST, 6 Oct)

The designers' palette is used exactly, so three pairs miss 4.5:1. They are the only exclusions anywhere: pinned with their ratios in `contrast.test.ts`, and named in `scripts/a11y-browser.mjs`.

| Pair | Ratio | Where |
|---|---|---|
| Light `--amber-ink` `#A15C00` on `--bg` `#ECEDF0` | 4.43:1 | amber text on the shell background (4.75:1 on the page `#F2F5FA`) |
| White 16 px bold on the light primary gradient's top stop `#6A88EE` | 3.30:1 | primary buttons (bottom stop 4.67:1) |
| White on the dark primary gradient's top stop `#3A84FF` | 3.54:1 | primary buttons, dark (bottom stop 5.57:1) |

In the Chrome pass axe never matched these: it reports text on a gradient as "incomplete" (it cannot pick one background colour), and the amber pair did not occur on the checked screens. The token test is what holds them.

### Found, not fixed (needs the designers)

The Chrome pass found four more pairs below 4.5:1, all in `design/designer.css`. Fixing them changes the designers' colours, so they are recorded here and not restyled; the script fails on them until a decision is made.

Four more contrast misses found by axe in headless Chrome (`web/scripts/a11y-browser.mjs`), all in the designers' stylesheet, outside D-CONTRAST: Camera setup's not-yet step labels `#8A9099` on `#F2F5FA` 2.94:1 (light); Calendar's untracked day lines `#6A7390` on `#F4F7FB` 4.37:1 (light); Calendar's clinic tag `#8391AA` on `#392E21` 4.15:1 (dark); Therapist's neutral chips `#8391AA` on `#253246` 4.06:1 (dark).

| Screen | Element | Pair | Ratio |
|---|---|---|---|
| Camera setup, light | Step labels not yet reached (`.cs-step`) | `#8A9099` on `#F2F5FA` | 2.94:1 (6 nodes) |
| Calendar, light | Day lines of untracked days (`.cal-untracked .cal-line`) | `#6A7390` on `#F4F7FB` | 4.37:1 (7 nodes) |
| Calendar, dark | Clinic visit tag (`.cal-line-clinic`) | `#8391AA` on `#392E21` | 4.15:1 |
| Therapist, dark | Neutral chips in the patient list (`.ui-chip--neutral`) | `#8391AA` on `#253246` | 4.06:1 (3 nodes) |

Totals: 18 issues fixed (1–7 from axe, 8–18 from the keyboard and screen-reader review), 3 excepted by decision, 4 contrast pairs (17 nodes) open. axe in jsdom now reports 0 violations on 21 page renders and 13 dialog / state renders; the Chrome pass reports only the 4 open pairs.

## 4. Screen-reader behaviour, as built

- **Landmarks:** patient screens: `header` (banner) with the `nav` "Hubs", one `main`; live screens: their own `header` and `main`, the control bar as a `footer`; Therapist: banner + `main`. Every page has one `h1` and headings in order.
- **Names:** every icon-only control has an accessible name (axe `button-name` / `link-name` pass on every screen); the rail's hub labels are visually hidden text, not tooltips only.
- **Live regions:** on a live screen the coach caption is the one polite announcer (`SxCoach`; since 21 Oct the browser also speaks each cue when Audio is on, and the caption stays on while it does). The counters and progress card are not live. The state chip in the header (`role="status"`) changes only on state transitions (connecting, tracking, lost, paused). Stops are `role="alertdialog"`; a blocked camera is `role="alert"`.
- **Status never by colour alone:** status chips, area states, week dots, board holes and verified / unverified counts all carry words or a text label (`role="img"` with a name where the visual is a shape).
- **Forms:** every input, scale and switch has a label (axe `label`, `aria-input-field-name` pass).

## 5. Motion and safety

- Settings › Reduced motion and the system setting stop every CSS animation (`designer.css`, `tokens.css`), the session reference figures (`RefAvatar`, `CupRef`, already) and, since this audit, the Home and Demonstration figures (they wait for Play).
- Nothing flashes: every looping animation is a soft fade or ping slower than 1 cycle per 1.2 s, below the 3 Hz threshold (`flash.a11y.test.ts`).
- The Demonstration has Play / Pause / Replay / Slower (2.2.2).

## 6. Remaining limitations

- **Spoken coach, always captioned (21 Oct).** The coach voice was removed on 10 Oct and restored on 21 Oct, because patients stand too far from the screen to read captions (Arm out to the side is done 2–2.5 m from the laptop). When Audio is on, cues are spoken by the browser (`SpeechSynthesis`); they are always captioned, and captions cannot be switched off. Audio is off by default since 24 Oct (`PREFS_DEFAULT` in `web/src/lib/prefs.ts`) and one tap turns it on. Controls, checked by reading the code, not with a screen reader: Settings › Audio (off by default); the session bar's volume is a native range input named "Coach voice volume" with its value as text (`aria-valuetext`, e.g. "60%"); the Demonstration's Audio button is a toggle with `aria-pressed` and visible text "Audio on" / "Audio off". Open: the voice and a screen reader can talk over each other (the caption is also a polite live region), and the browser voice varies by device and language pack. Polly is not used.
- **No real assistive-technology testing yet** (§1). Pilot sessions should include at least one keyboard-only run and one VoiceOver run of the default day.
- **The camera view and the figure are visual.** The overlay canvas and the WebGL figure have no text equivalent of their own; the same information is given in text (status band, counts, captions, the Demonstration's step captions), but a blind patient cannot use the camera-coached exercises in a meaningful way.
- **Radio groups keep every option as a Tab stop** (plus arrows), instead of the WAI-ARIA single-Tab-stop pattern; only the pain / effort scales use a roving tab index.
- **Target size:** controls are 40–48 px as the designers drew them (D-SIZE). That meets 2.1 AA (2.5.5 target size is AAA) but is harder for patients with impaired hand control.
- **Text over live video** (the "You" tag and band over the camera) has its own backing, but its contrast against a real room is not measurable in the test pages.
- The Chrome pass covers the screens, not every dialog; the dialogs are checked in jsdom without contrast.

## 7. Rerun

```bash
cd web
pnpm test                                    # includes src/a11y/*.a11y.test.* and contrast.test.ts
pnpm build:design && node scripts/a11y-browser.mjs --json /tmp/axe.json   # needs Chrome (CHROME_PATH)
```
