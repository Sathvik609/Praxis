import { createBrowserRouter } from 'react-router-dom'
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
      { path: 'progress', element: <Progress /> },
      { path: 'settings', element: <Settings /> },
      { path: 'checkin', element: <CheckIn /> },
      { path: 'choose', element: <ChooseExercise /> },
      { path: 'setup', element: <CameraSetup /> },
      { path: 'demo', element: <Demonstration /> },
      { path: 'report', element: <AssessmentResult /> },
      { path: 'report/:id', element: <SessionReport /> },
      { path: 'therapist', element: <Therapist /> },
      { path: 'coach', element: <CoachDrawer /> },
    ],
  },
])
