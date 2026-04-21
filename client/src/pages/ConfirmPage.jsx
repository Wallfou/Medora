import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMedora } from "../context/MedoraContext.jsx";

export default function ConfirmPage() {
  const navigate = useNavigate();
  const {
    rows,
    updateRow,
    patchRow,
    addRow,
    removeRow,
    runAnalyze,
    loading,
    error,
    clearError,
    file,
  } = useMedora();

  useEffect(() => {
    if (!rows.length) navigate("/", { replace: true });
  }, [rows.length, navigate]);

  if (!rows.length) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#ececee] pb-0">
      <header className="sticky top-0 z-[2] bg-white px-4 pb-4 pt-3 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
        <Link
          to={file ? "/camera" : "/"}
          className="mb-1.5 inline-block text-xl leading-none text-primary no-underline"
          aria-label="Go back"
        >
          ←
        </Link>
        <h1 className="m-0 text-[1.35rem] font-bold tracking-tight text-text">
          {file ? "We found these medications" : "Your medications"}
        </h1>
      </header>

      {error && (
        <div className="mx-4 mb-0 mt-2 rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[0.85rem] text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-[6.5rem] pt-4">
        {rows.map((r) => (
          <article
            key={r.id}
            className="flex items-stretch gap-2 rounded-[14px] bg-white py-4 pl-4 pr-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
          >
            <div className="min-w-0 flex-1">
              {r.extracted && r.drug_name ? (
                <>
                  <p className="m-0 text-[1.05rem] font-bold text-text">{r.drug_name}</p>
                  <p className="mb-0 mt-0.5 text-[0.88rem] text-muted">
                    {r.dosage || <span className="text-muted-2">—</span>}
                  </p>
                  <label className="mt-2.5 flex flex-col gap-1">
                    <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-2">
                      Database lookup
                    </span>
                    <input
                      className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[0.9rem] focus:border-primary focus:outline focus:outline-2 focus:outline-[rgba(45,122,94,0.25)]"
                      value={r.normalized}
                      onChange={(e) => {
                        clearError();
                        updateRow(r.id, "normalized", e.target.value);
                      }}
                      placeholder="e.g. metformin"
                      autoComplete="off"
                    />
                  </label>
                </>
              ) : (
                <>
                  <input
                    className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[1.05rem] font-bold focus:border-primary focus:outline focus:outline-2 focus:outline-[rgba(45,122,94,0.25)]"
                    value={r.normalized}
                    onChange={(e) => {
                      clearError();
                      const v = e.target.value;
                      patchRow(r.id, { normalized: v, drug_name: v });
                    }}
                    placeholder="Medication name"
                    autoComplete="off"
                  />
                  <input
                    className="mt-1.5 w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[0.9rem] text-muted focus:border-primary focus:outline focus:outline-2 focus:outline-[rgba(45,122,94,0.25)]"
                    value={r.dosage}
                    onChange={(e) => {
                      clearError();
                      updateRow(r.id, "dosage", e.target.value);
                    }}
                    placeholder="Dosage (optional)"
                    autoComplete="off"
                  />
                </>
              )}
            </div>
            <div className="flex flex-col items-center justify-center gap-2 pl-1">
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 cursor-default items-center justify-center rounded-full border-none bg-emerald-100 text-primary"
                title="Included"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                  <path
                    d="M6 12l4 4 8-8"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <button
                type="button"
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-red-100 text-red-700 disabled:cursor-not-allowed disabled:opacity-[0.35]"
                aria-label={`Remove ${r.drug_name || r.normalized || "medication"}`}
                onClick={() => {
                  clearError();
                  removeRow(r.id);
                }}
                disabled={rows.length <= 1}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                  <path
                    d="M8 8l8 8M16 8l-8 8"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </article>
        ))}

        <button
          type="button"
          className="mt-1 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[14px] border-none bg-white py-4 text-[0.95rem] font-semibold text-primary shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
          onClick={() => addRow()}
        >
          <span className="text-xl font-medium leading-none">+</span>
          Add another medication
        </button>
      </div>

      <div className="sticky bottom-0 left-0 right-0 bg-[linear-gradient(to_top,#ececee_85%,transparent)] px-4 pb-5 pt-4">
        <button
          type="button"
          className="inline-flex w-full max-w-full items-center justify-center gap-2.5 rounded-full bg-primary px-6 py-4 text-base font-semibold text-white shadow-[0_6px_20px_rgba(45,122,94,0.35)] transition-transform duration-100 hover:bg-primary-dark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-[0.65]"
          disabled={loading}
          onClick={() => runAnalyze()}
        >
          {loading ? "Checking…" : "Check interactions"}
        </button>
      </div>
    </div>
  );
}
