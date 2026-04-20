import { useNavigate } from "react-router-dom";
import { FaCamera, FaLock } from "react-icons/fa";
import { useMedora } from "../context/MedoraContext.jsx";

export default function HomePage() {
  const navigate = useNavigate();
  const { clearError, goManual } = useMedora();

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f9f9f9] px-6 pb-6 pt-9 text-center">
      <div className="flex flex-1 flex-col items-center justify-center">
        <header className="mb-3 flex items-center justify-center gap-[0.65rem]">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary"
            aria-hidden
          >
            <svg viewBox="0 0 24 24" className="h-[26px] w-[26px]" fill="none">
              <path
                d="M8 10V8a4 4 0 0 1 8 0v2"
                stroke="#fff"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <rect
                x="5"
                y="10"
                width="14"
                height="11"
                rx="2"
                stroke="#fff"
                strokeWidth="1.8"
              />
              <path
                d="M12 14v3M10.5 15.5h3"
                stroke="#fff"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <span className="text-4xl font-bold tracking-tight text-primary">Medora</span>
        </header>

        <h1 className="mb-10 text-[1.6rem] font-bold leading-tight tracking-tight text-text">
          Check your medications
          <br />
          safely
        </h1>

        <div className="flex flex-col items-center gap-6">
          <button
            type="button"
            className="inline-flex w-full max-w-full items-center justify-center gap-2.5 rounded-full bg-primary px-6 py-4 text-base font-semibold text-white shadow-[0_6px_20px_rgba(45,122,94,0.35)] transition-transform duration-100 hover:bg-primary-dark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-[0.65]"
            onClick={() => {
              clearError();
              navigate("/camera");
            }}
          >
            <FaCamera className="h-[22px] w-[22px] shrink-0" aria-hidden />
            Scan Your Medications
          </button>

          <button
            type="button"
            className="cursor-pointer border-none bg-transparent p-0 text-[0.95rem] font-medium text-primary underline decoration-solid underline-offset-[3px]"
            onClick={() => {
              clearError();
              goManual();
            }}
          >
            Or type medication names manually
          </button>
        </div>
      </div>

      <p className="mt-8 flex items-center justify-center gap-1.5 text-[0.8rem] text-muted">
        <FaLock className="h-3 w-3 shrink-0" aria-hidden />
        Everything stays on your device. No internet needed.
      </p>

      <p className="mx-auto mt-4 max-w-[40ch] text-[0.72rem] leading-snug text-muted-2">
        Medora is educational, not medical advice. Talk to your doctor or pharmacist. Uses Ollama and a
        local database on your machine.
      </p>
    </div>
  );
}
