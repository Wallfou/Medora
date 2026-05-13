import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowLeft, FaPrint } from "react-icons/fa";
import { useMedora } from "../context/MedoraContext.jsx";

const SEVERITY_ORDER = { major: 0, moderate: 1, minor: 2 };

function severityLabel(sev) {
  if (sev === "major") return "Major";
  if (sev === "moderate") return "Moderate";
  if (sev === "minor") return "Minor";
  return (sev || "—").toString();
}

function normalizeMeds(meds) {
  return (meds || [])
    .map((m) =>
      typeof m === "string"
        ? { name: m, dosage: "" }
        : { name: m?.name || "", dosage: m?.dosage || "" }
    )
    .filter((m) => m.name);
}

export default function ReportPage() {
  const navigate = useNavigate();
  const { result } = useMedora();

  const meds = useMemo(() => normalizeMeds(result?.medications), [result]);
  const interactions = useMemo(() => {
    const list = (result?.interactions || []).slice();
    list.sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
    );
    return list;
  }, [result]);
  const beers = result?.beers_flags || [];

  const reportDate = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    []
  );

  useEffect(() => {
    if (!result) {
      navigate("/", { replace: true });
    }
  }, [result, navigate]);

  if (!result) return null;

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-white print:bg-white">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200/80 bg-white px-4 py-3 print:hidden">
        <button
          type="button"
          onClick={() => navigate("/results")}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-text"
          aria-label="Back to dashboard"
        >
          <FaArrowLeft size={18} />
        </button>
        <h1 className="m-0 text-[1.1rem] font-bold tracking-tight text-text">
          Doctor Report
        </h1>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-none bg-primary text-white"
          aria-label="Print or save as PDF"
        >
          <FaPrint size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 print:overflow-visible print:px-8 print:py-6">
        <header className="mb-6 border-b border-gray-300 pb-3">
          <h2 className="m-0 text-[1.5rem] font-bold tracking-tight text-text">
            Medication Review Report
          </h2>
          <p className="m-0 mt-1 text-[0.85rem] text-muted">
            Prepared {reportDate} · For discussion with your doctor
          </p>
        </header>

        <section className="mb-6">
          <h3 className="m-0 mb-2 text-[1rem] font-bold uppercase tracking-[0.06em] text-text">
            Medications
          </h3>
          {meds.length === 0 ? (
            <p className="m-0 text-[0.95rem] text-muted">None listed.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {meds.map((m, i) => (
                <li
                  key={`${m.name}-${i}`}
                  className="flex items-baseline gap-3 border-b border-gray-100 py-1.5 last:border-b-0"
                >
                  <span className="text-[0.98rem] font-semibold capitalize text-text">
                    {m.name}
                  </span>
                  <span className="text-[0.9rem] text-muted">
                    {m.dosage || "dose not recorded"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-6">
          <h3 className="m-0 mb-2 text-[1rem] font-bold uppercase tracking-[0.06em] text-text">
            Drug Interactions Found
          </h3>
          {interactions.length === 0 ? (
            <p className="m-0 text-[0.95rem] text-muted">
              No drug-drug interactions identified in our database.
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {interactions.map((ix, i) => (
                <li
                  key={`${ix.drug1}-${ix.drug2}-${i}`}
                  className="border-b border-gray-100 py-2 last:border-b-0"
                >
                  <p className="m-0 text-[0.98rem] font-semibold capitalize text-text">
                    {ix.drug1} + {ix.drug2}
                    <span
                      className={`ml-2 inline-block rounded px-1.5 py-0.5 align-middle text-[0.7rem] font-bold uppercase tracking-wide ${
                        ix.severity === "major"
                          ? "bg-red-100 text-red-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {severityLabel(ix.severity)}
                    </span>
                  </p>
                  {ix.description && (
                    <p className="m-0 mt-1 text-[0.9rem] leading-snug text-muted">
                      {ix.description}
                    </p>
                  )}
                  {ix.management && (
                    <p className="m-0 mt-1 text-[0.85rem] leading-snug text-muted">
                      <span className="font-semibold text-text">Guidance:</span>{" "}
                      {ix.management}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-6">
          <h3 className="m-0 mb-2 text-[1rem] font-bold uppercase tracking-[0.06em] text-text">
            Older-Adult Safety Concerns
          </h3>
          {beers.length === 0 ? (
            <p className="m-0 text-[0.95rem] text-muted">
              No Beers Criteria concerns identified.
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {beers.map((b, i) => (
                <li
                  key={`${b.drug}-${i}`}
                  className="border-b border-gray-100 py-2 last:border-b-0"
                >
                  <p className="m-0 text-[0.98rem] font-semibold capitalize text-text">
                    {b.drug}
                    {b.drug_class && (
                      <span className="ml-2 text-[0.85rem] font-normal text-muted">
                        ({b.drug_class})
                      </span>
                    )}
                  </p>
                  {b.recommendation && (
                    <p className="m-0 mt-1 text-[0.9rem] leading-snug text-text">
                      {b.recommendation}
                    </p>
                  )}
                  {b.rationale && (
                    <p className="m-0 mt-1 text-[0.85rem] leading-snug text-muted">
                      <span className="font-semibold text-text">Why:</span>{" "}
                      {b.rationale}
                    </p>
                  )}
                  {b.alternatives && (
                    <p className="m-0 mt-1 text-[0.85rem] leading-snug text-muted">
                      <span className="font-semibold text-text">
                        Alternatives:
                      </span>{" "}
                      {b.alternatives}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-8 border-t border-gray-200 pt-3 text-[0.78rem] leading-snug text-muted-2">
          Medora is an educational tool, not medical advice. This report is a
          starting point for a conversation with your doctor or pharmacist.
        </footer>
      </div>

      <div className="shrink-0 border-t border-gray-200/80 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] print:hidden">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate("/results")}
            className="flex-1 cursor-pointer rounded-full border-2 border-primary bg-white px-4 py-3 text-[0.95rem] font-bold text-primary"
          >
            Back to Dashboard
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border-none bg-primary px-4 py-3 text-[0.95rem] font-bold text-white shadow-[0_4px_14px_rgba(45,122,94,0.3)]"
          >
            <FaPrint size={14} />
            Print / Save PDF
          </button>
        </div>
      </div>
    </div>
  );
}
