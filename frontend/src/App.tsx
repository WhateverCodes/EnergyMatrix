import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ScenarioProvider } from './app/ScenarioContext'
import { Shell } from './components/Shell'
import BuilderPage from './pages/BuilderPage'
import PlayPage from './pages/PlayPage'
import AtlasPage from './pages/AtlasPage'
import GridPage from './pages/GridPage'
import ActionsPage from './pages/ActionsPage'
import LabPage from './pages/LabPage'
import ForecastPage from './pages/ForecastPage'
import WhatIfPage from './pages/WhatIfPage'
import LibraryPage from './pages/LibraryPage'

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 60_000 } } })

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ScenarioProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<PlayPage />} />
              <Route path="atlas" element={<AtlasPage />} />
              <Route path="builder" element={<BuilderPage />} />
              <Route path="grid" element={<GridPage />} />
              <Route path="lab" element={<LabPage />} />
              <Route path="actions" element={<ActionsPage />} />
              <Route path="forecast" element={<ForecastPage />} />
              <Route path="whatif" element={<WhatIfPage />} />
              <Route path="library" element={<LibraryPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ScenarioProvider>
    </QueryClientProvider>
  )
}
