import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { useHazards } from '../store/hazards'

export default function Layout() {
  const refresh = useHazards((s) => s.refresh)

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [refresh])

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}