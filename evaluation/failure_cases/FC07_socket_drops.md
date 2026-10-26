# FC07 — Live sockets dropped before the session was saved

**Source:** team test on the hosted 13 Oct build (people) · **Status:** mitigated; cause open (instrumented)

## What happened
On 13 Oct two Arm out to the side sessions never ended: the WebSocket closed while the feedback
form was open, Save / Skip went into the dead socket and waited for an ack, End did nothing, and
nothing was stored. Both drops came about 20 s after an agent run, on a ~4 fps feed.

## Evidence
There is no stored data: a session is saved only when its feedback arrives. The record is
the team's notes (2026-10-13, "Team test: two Arm sessions never ended") and
`evaluation/results/team_test_2026-10-21.md`, "Socket closes" (not recorded on the 13 Oct build).

## Why
The stuck screen was a client bug (feedback sent into a closed socket, End latched). Why the
socket dropped is not known.

## What we changed
`4478689` (13 Oct): Save / Skip on a closed socket, a drop after the feedback, or no ack within
5 s all leave for the report; the camera stops at End; patient-ended sessions are stored
`ended_early`. `6c9ce02` (21 Oct): every live socket writes a `socket_close` trace row (saved or
not, close code, agent run in flight, seconds since the last agent run), and `/api/review` counts
sockets that closed before their session was saved.

## Status
Mitigated (no more stuck screen); the cause of the drops is open until a test runs on a build
with `6c9ce02`.
