import { Navigate, createBrowserRouter } from 'react-router-dom'
import { Home } from '../screens/02-home/Home'
import { CheckIn } from '../screens/03-checkin/CheckIn'
import { ChooseExercise } from '../screens/04-choose/ChooseExercise'
import { SessionReport } from '../screens/09-report/SessionReport'
import { Progress } from '../screens/10-progress/Progress'
import { Therapist } from '../screens/11-therapist/Therapist'
import { Calendar } from '../screens/12-calendar/Calendar'
import { CoachDrawer } from '../screens/coach/CoachDrawer'
import { Settings } from '../screens/settings/Settings'
import { CameraSetup } from '../screens/05-camera-setup/CameraSetup'
import { Demonstration } from '../screens/06-demo/Demonstration'
import { SessionRouter } from '../screens/07-session/SessionRouter'
import { AssessmentResult } from '../screens/09-report/AssessmentResult'
import { Shell } from './Shell'

/** One path through the app: everything built to wireframes v1.1 lives under `/details/*`
 *  (Home is the front door; `/` redirects there). `/session` and `/report/:id` keep their
 *  paths so replay links and report links resolve. No sign-in and no onboarding: the app
 *  opens straight on Home.
 *
 *  The live session and the clinician dashboard render outside the patient Shell. */
export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/details" replace /> },
  { path: '/session', element: <SessionRouter /> },
  { path: '/therapist', element: <Therapist /> },
  { path: '/details/therapist', element: <Therapist /> },
  {
    element: <Shell />,
    children: [
      { path: 'report', element: <AssessmentResult /> },
      { path: 'report/:id', element: <SessionReport /> },
      { path: 'details', element: <Home /> },
      { path: 'details/exercises', element: <ChooseExercise /> },
      { path: 'details/progress', element: <Progress /> },
      { path: 'details/calendar', element: <Calendar /> },
      { path: 'details/settings', element: <Settings /> },
      { path: 'details/checkin', element: <CheckIn /> },
      { path: 'details/choose', element: <ChooseExercise /> },
      { path: 'details/setup', element: <CameraSetup /> },
      { path: 'details/demo', element: <Demonstration /> },
      { path: 'details/report', element: <AssessmentResult /> },
      { path: 'details/report/:id', element: <SessionReport /> },
      { path: 'details/coach', element: <CoachDrawer /> },
      { path: '*', element: <Navigate to="/details" replace /> },
    ],
  },
])
