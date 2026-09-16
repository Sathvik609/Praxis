import { createBrowserRouter } from 'react-router-dom'
import { CameraSetup } from '../screens/05-camera-setup/CameraSetup'
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
      { index: true, element: <Pending n="02" title="Home" /> },
      { path: 'exercises', element: <Pending n="04" title="Choose exercise" /> },
      { path: 'progress', element: <Pending n="10" title="Progress and history" /> },
      { path: 'settings', element: <Pending n="—" title="Settings" /> },
      { path: 'checkin', element: <Pending n="03" title="Pre-session check-in" /> },
      { path: 'choose', element: <Pending n="04" title="Choose exercise" /> },
      { path: 'setup', element: <CameraSetup /> },
      { path: 'demo', element: <Pending n="06" title="Demonstration" /> },
      { path: 'report', element: <AssessmentResult /> },
      { path: 'therapist', element: <Pending n="11" title="Therapist dashboard" /> },
    ],
  },
])
