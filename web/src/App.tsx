import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Nav } from './components/Nav'
import { Home } from './routes/Home'

function Placeholder({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="text-lg text-slate-600">Coming in a later week.</p>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/exercises" element={<Placeholder title="Exercises" />} />
            <Route path="/progress" element={<Placeholder title="Progress" />} />
            <Route path="/reports" element={<Placeholder title="Reports" />} />
            <Route path="/coach" element={<Placeholder title="Coach" />} />
            <Route path="/settings" element={<Placeholder title="Settings" />} />
          </Routes>
        </main>
        <Nav />
      </div>
    </BrowserRouter>
  )
}
