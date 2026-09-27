import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ScenarioProvider } from './app/ScenarioContext'
import { Shell } from './components/Shell'
import BuilderPage from './pages/BuilderPage'
import GridPage from './pages/GridPage'
import ActionsPage from './pages/ActionsPage'
import LabPage from './pages/LabPage'

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 60_000 } } })

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ScenarioProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<BuilderPage />} />
              <Route path="grid" element={<GridPage />} />
              <Route path="lab" element={<LabPage />} />
              <Route path="actions" element={<ActionsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ScenarioProvider>
    </QueryClientProvider>
  )
}
