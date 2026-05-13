import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { MedoraProvider } from "./context/MedoraContext.jsx";
import HomePage from "./pages/HomePage.jsx";
import CameraPage from "./pages/CameraPage.jsx";
import ConfirmPage from "./pages/ConfirmPage.jsx";
import ResultsPage from "./pages/ResultsPage.jsx";
import AskPage from "./pages/AskPage.jsx";
import ReportPage from "./pages/ReportPage.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <MedoraProvider>
        <div className="flex min-h-screen justify-center bg-bg">
          <div className="flex min-h-screen w-full max-w-[640px] flex-col bg-bg">
            <div className="flex min-h-0 flex-1 flex-col">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/camera" element={<CameraPage />} />
                <Route path="/confirm" element={<ConfirmPage />} />
                <Route path="/results" element={<ResultsPage />} />
                <Route path="/ask" element={<AskPage />} />
                <Route path="/report" element={<ReportPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </div>
        </div>
      </MedoraProvider>
    </BrowserRouter>
  );
}
