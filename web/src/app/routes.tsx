import { createBrowserRouter } from 'react-router-dom'
import { Pending } from '../screens/placeholders'
import { Shell } from './Shell'

export const router = createBrowserRouter([
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
      { path: 'setup', element: <Pending n="05" title="Camera setup" /> },
      { path: 'demo', element: <Pending n="06" title="Demonstration" /> },
      { path: 'session', element: <Pending n="07" title="Live session" /> },
      { path: 'report', element: <Pending n="09" title="Session report" /> },
      { path: 'therapist', element: <Pending n="11" title="Therapist dashboard" /> },
    ],
  },
])
