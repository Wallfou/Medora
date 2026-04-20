import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MedoraProvider } from "./context/MedoraContext.jsx";
import HomePage from "./pages/HomePage.jsx";
import CameraPage from "./pages/CameraPage.jsx";
import ConfirmPage from "./pages/ConfirmPage.jsx";
import ResultsPage from "./pages/ResultsPage.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <MedoraProvider>
        <div className="flex min-h-screen items-stretch justify-center px-3 pb-8 pt-4 sm:items-center sm:px-4 sm:pb-10 sm:pt-6">
          <div className="flex min-h-[min(100vh-0.5rem,900px)] max-h-[min(100dvh-1rem,900px)] w-full max-w-[450px] flex-col overflow-hidden rounded-phone bg-surface shadow-phone">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/camera" element={<CameraPage />} />
                <Route path="/confirm" element={<ConfirmPage />} />
                <Route path="/results" element={<ResultsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </div>
        </div>
      </MedoraProvider>
    </BrowserRouter>
  );
}
