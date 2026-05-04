import { NavLink, useNavigate } from 'react-router-dom'
import { Database, BarChart2, Bell, Settings, LogOut, Mail } from 'lucide-react'
import { useApp } from '../context/AppContext'

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
}

const navItems: NavItem[] = [
  { to: '/import', label: 'Import Data', icon: <Database size={16} /> },
  { to: '/reports', label: 'Reports', icon: <BarChart2 size={16} /> },
  { to: '/mail', label: 'Send Mail', icon: <Mail size={16} /> },
  { to: '/alerts', label: 'Alerts', icon: <Bell size={16} /> },
  { to: '/settings', label: 'Settings', icon: <Settings size={16} /> },
]

export default function Sidebar() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const user = state.user

  function handleLogout() {
    dispatch({ type: 'LOGOUT' })
    navigate('/login')
  }

  const initials = user?.name
    ? user.name.trim().charAt(0).toUpperCase()
    : '?'

  return (
    <aside className="w-60 flex-shrink-0 bg-[#F8FAFC] border-r border-slate-200/60 flex flex-col h-screen">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-slate-200/60">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-white">
            <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div>
          <span className="text-slate-800 font-semibold text-base tracking-tight leading-none">Rsend</span>
          <p className="text-slate-400 text-[10px] mt-0.5 font-medium tracking-wide">Email Delivery System</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                isActive
                  ? 'bg-white shadow-sm text-indigo-600 font-semibold border border-slate-200/80'
                  : 'text-slate-500 hover:bg-white/70 hover:text-slate-700 font-medium'
              }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* User Section */}
      <div className="px-3 py-4 border-t border-slate-200/60">
        <div className="flex items-center gap-2.5 px-3 py-2.5 mb-1 rounded-lg">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-semibold">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-700 truncate leading-tight">{user?.name ?? 'User'}</p>
            <p className="text-[10px] text-slate-400 truncate leading-tight mt-0.5">{user?.email ?? ''}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors duration-150"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
