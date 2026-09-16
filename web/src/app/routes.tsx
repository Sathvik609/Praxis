import { createBrowserRouter } from 'react-router-dom'
import { SignIn } from '../screens/01-signin/SignIn'
import { Home } from '../screens/02-home/Home'
import { CheckIn } from '../screens/03-checkin/CheckIn'
import { ChooseExercise } from '../screens/04-choose/ChooseExercise'
import { SessionReport } from '../screens/09-report/SessionReport'
import { CameraSetup } from '../screens/05-camera-setup/CameraSetup'
import { Demonstration } from '../screens/06-demo/Demonstration'
import { SessionRouter } from '../screens/07-session/SessionRouter'
import { AssessmentResult } from '../screens/09-report/AssessmentResult'
import { Pending } from '../screens/placeholders'
import { Shell } from './Shell'

export const router = createBrowserRouter([
  { path: '/session', element: <SessionRouter /> },
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <Home /> },
      { path: 'exercises', element: <ChooseExercise /> },
      { path: 'signin', element: <SignIn /> },
      { path: 'progress', element: <Pending n="10" title="Progress and history" /> },
      { path: 'settings', element: <Pending n="—" title="Settings" /> },
      { path: 'checkin', element: <CheckIn /> },
      { path: 'choose', element: <ChooseExercise /> },
      { path: 'setup', element: <CameraSetup /> },
      { path: 'demo', element: <Demonstration /> },
      { path: 'report', element: <AssessmentResult /> },
      { path: 'report/:id', element: <SessionReport /> },
      { path: 'therapist', element: <Pending n="11" title="Therapist dashboard" /> },
      { path: 'coach', element: <Pending n="04c" title="Coach drawer (Phase 8)" /> },
    ],
  },
])
