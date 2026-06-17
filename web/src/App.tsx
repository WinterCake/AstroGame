import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PlanetSourceProvider } from "./context/PlanetSourceContext";
import { AttacksPage } from "./pages/AttacksPage";
import { EmpirePage } from "./pages/EmpirePage";
import { GalaxyPage } from "./pages/GalaxyPage";
import { SpyPage } from "./pages/SpyPage";

export function App() {
  return (
    <BrowserRouter>
      <PlanetSourceProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/empire" replace />} />
            <Route path="empire" element={<EmpirePage />} />
            <Route path="galaxy" element={<GalaxyPage />} />
            <Route path="spy" element={<SpyPage />} />
            <Route path="attacks" element={<AttacksPage />} />
          </Route>
        </Routes>
      </PlanetSourceProvider>
    </BrowserRouter>
  );
}
