import type { Page } from '../../types/index.js'
import { useHealth } from '../../hooks/useHealth.js'

interface NavItem {
  page: Page
  label: string
  icon: string
}

const NAV_ITEMS: NavItem[] = [
  { page: 'dashboard', label: 'Dashboard', icon: '⊞' },
  { page: 'queue', label: 'Queue', icon: '⋮' },
  { page: 'settings', label: 'Settings', icon: '⚙' },
]

interface SidebarProps {
  current: Page
  onNavigate: (page: Page) => void
}

export function Sidebar({ current, onNavigate }: SidebarProps) {
  const health = useHealth()

  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <span className="logo-text">AI Agent</span>
        <span className={`health-dot health-${health}`} title={health === 'ok' ? 'Server online' : 'Server offline'} />
      </div>
      <ul className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <li key={item.page}>
            <button
              className={`nav-item ${current === item.page ? 'active' : ''}`}
              onClick={() => onNavigate(item.page)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
