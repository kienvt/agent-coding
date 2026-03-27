import { useState } from 'react'
import { Sidebar } from './components/layout/Sidebar.js'
import { ToastProvider } from './components/ui/Toast.js'
import { DashboardPage } from './pages/DashboardPage.js'
import { ProjectPage } from './pages/ProjectPage.js'
import { QueuePage } from './pages/QueuePage.js'
import { SettingsPage } from './pages/SettingsPage.js'
import type { Page } from './types/index.js'

export function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)

  const navigateTo = (p: Page, slug?: string) => {
    setPage(p)
    if (slug !== undefined) setSelectedSlug(slug)
  }

  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return (
          <DashboardPage
            onSelectProject={(slug) => navigateTo('project', slug)}
            onNavigate={(p) => navigateTo(p)}
          />
        )
      case 'project':
        return (
          <ProjectPage
            slug={selectedSlug}
            onBack={() => navigateTo('dashboard')}
          />
        )
      case 'queue':
        return <QueuePage />
      case 'settings':
        return <SettingsPage />
    }
  }

  return (
    <ToastProvider>
      <div className="app-shell">
        <Sidebar current={page === 'project' ? 'dashboard' : page} onNavigate={(p) => navigateTo(p)} />
        <main className="app-content">{renderPage()}</main>
      </div>
    </ToastProvider>
  )
}
