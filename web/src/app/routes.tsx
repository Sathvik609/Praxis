import { createBrowserRouter, Navigate } from 'react-router-dom'
import { SignIn } from '../screens/01-signin/SignIn'
import { Home } from '../screens/02-home/Home'
import { CheckIn } from '../screens/03-checkin/CheckIn'
import { ChooseExercise } from '../screens/04-choose/ChooseExercise'
import { SessionReport } from '../screens/09-report/SessionReport'
import { Progress } from '../screens/10-progress/Progress'
import { Therapist } from '../screens/11-therapist/Therapist'
import { CoachDrawer } from '../screens/coach/CoachDrawer'
import { Settings } from '../screens/settings/Settings'
import { CameraSetup } from '../screens/05-camera-setup/CameraSetup'
import { Demonstration } from '../screens/06-demo/Demonstration'
import { SessionRouter } from '../screens/07-session/SessionRouter'
import { AssessmentResult } from '../screens/09-report/AssessmentResult'
import { Welcome } from '../screens/guided/Welcome'
import { RequireAuth } from './RequireAuth'
import { Shell } from './Shell'

/** Two paths through the app (Sprint E).
 *
 *  The **guided path** is the front door: `/` Today, `/welcome` onboarding, `/ready` get ready,
 *  `/go` session, `/done/:id` finish. It has no nav bar — one screen, one primary action.
 *
 *  The **details hub** is everything built to wireframes v1.1, still reachable under
 *  `/details/*` for the therapist story and for judges. `/session` and `/report/:id` keep their
 *  old paths so replay links and report links from either path resolve.
 *
 *  Sign-in, the live session and the clinician dashboard render outside the patient Shell. */
export const router = createBrowserRouter([
  { path: '/session', element: <RequireAuth><SessionRouter /></RequireAuth> },
  { path: '/signin', element: <SignIn /> },
  { path: '/therapist', element: <RequireAuth><Therapist /></RequireAuth> },
  { path: '/details/therapist', element: <RequireAuth><Therapist /></RequireAuth> },
  { path: '/welcome', element: <RequireAuth><Welcome /></RequireAuth> },
  { path: '/', element: <Navigate to="/details" replace /> },
  {
    element: <RequireAuth><Shell /></RequireAuth>,
    children: [
      { path: 'report', element: <AssessmentResult /> },
      { path: 'report/:id', element: <SessionReport /> },
      { path: 'details', element: <Home /> },
      { path: 'details/exercises', element: <ChooseExercise /> },
      { path: 'details/progress', element: <Progress /> },
      { path: 'details/settings', element: <Settings /> },
      { path: 'details/checkin', element: <CheckIn /> },
      { path: 'details/choose', element: <ChooseExercise /> },
      { path: 'details/setup', element: <CameraSetup /> },
      { path: 'details/demo', element: <Demonstration /> },
      { path: 'details/report', element: <AssessmentResult /> },
      { path: 'details/report/:id', element: <SessionReport /> },
      { path: 'details/coach', element: <CoachDrawer /> },
    ],
  },
])
