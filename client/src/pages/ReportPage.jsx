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
    <div className="flex min-h-screen w-full flex-1 flex-col bg-bg print:bg-white">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-divider bg-bg px-4 py-3 print:hidden">
        <button
          type="button"
          onClick={() => navigate("/results")}
          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-text hover:bg-divider"
          aria-label="Back to dashboard"
        >
          <FaArrowLeft size={18} />
        </button>
        <h1 className="m-0 text-[1.15rem] font-bold tracking-tight text-text">
          Doctor report
        </h1>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-none bg-primary text-white hover:bg-primary-dark"
          aria-label="Print or save as PDF"
        >
          <FaPrint size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface px-6 py-8 print:overflow-visible print:bg-white print:px-10 print:py-8">
        <header className="mb-8 border-b border-divider pb-4">
          <h2 className="m-0 text-[1.875rem] font-bold tracking-tight text-text">
            Medication review
          </h2>
          <p className="m-0 mt-1.5 text-[0.95rem] text-muted">
            Prepared {reportDate} · For discussion with your doctor
          </p>
        </header>

        <section className="mb-8">
          <h3 className="m-0 mb-3 text-[1.2rem] font-semibold text-text">
            Medications
          </h3>
          {meds.length === 0 ? (
            <p className="m-0 text-[1rem] text-muted">None listed.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {meds.map((m, i) => (
                <li
                  key={`${m.name}-${i}`}
                  className="flex items-baseline justify-between gap-4 border-b border-divider py-2.5 last:border-b-0"
                >
                  <span className="text-[1.05rem] font-medium capitalize text-text">
                    {m.name}
                  </span>
                  <span className="text-[1rem] text-muted">
                    {m.dosage || "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-8">
          <h3 className="m-0 mb-3 text-[1.2rem] font-semibold text-text">
            Drug interactions
          </h3>
          {interactions.length === 0 ? (
            <p className="m-0 text-[1rem] text-muted">
              No drug-drug interactions were identified.
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {interactions.map((ix, i) => (
                <li
                  key={`${ix.drug1}-${ix.drug2}-${i}`}
                  className="border-b border-divider py-3 last:border-b-0"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="m-0 text-[1.05rem] font-semibold capitalize text-text">
                      {ix.drug1} + {ix.drug2}
                    </p>
                    <span
                      className={`shrink-0 text-[0.9rem] font-semibold ${
                        ix.severity === "major"
                          ? "text-alert"
                          : "text-warn"
                      }`}
                    >
                      {severityLabel(ix.severity)}
                    </span>
                  </div>
                  {ix.description && (
                    <p className="m-0 mt-1.5 text-[0.95rem] leading-snug text-muted">
                      {ix.description}
                    </p>
                  )}
                  {ix.management && (
                    <p className="m-0 mt-1.5 text-[0.95rem] leading-snug text-muted">
                      <span className="font-semibold text-text">Guidance:</span>{" "}
                      {ix.management}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-8">
          <h3 className="m-0 mb-3 text-[1.2rem] font-semibold text-text">
            Concerns for older adults
          </h3>
          {beers.length === 0 ? (
            <p className="m-0 text-[1rem] text-muted">
              No age-related concerns were identified.
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {beers.map((b, i) => (
                <li
                  key={`${b.drug}-${i}`}
                  className="border-b border-divider py-3 last:border-b-0"
                >
                  <p className="m-0 text-[1.05rem] font-semibold capitalize text-text">
                    {b.drug}
                    {b.drug_class && (
                      <span className="ml-2 text-[0.9rem] font-normal text-muted">
                        ({b.drug_class})
                      </span>
                    )}
                  </p>
                  {b.recommendation && (
                    <p className="m-0 mt-1.5 text-[0.95rem] leading-snug text-text">
                      {b.recommendation}
                    </p>
                  )}
                  {b.rationale && (
                    <p className="m-0 mt-1.5 text-[0.95rem] leading-snug text-muted">
                      <span className="font-semibold text-text">Why:</span>{" "}
                      {b.rationale}
                    </p>
                  )}
                  {b.alternatives && (
                    <p className="m-0 mt-1.5 text-[0.95rem] leading-snug text-muted">
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

        <footer className="mt-10 border-t border-divider pt-3 text-[0.85rem] leading-snug text-muted-2">
          Medora is educational and is not medical advice. This report is a
          starting point for a conversation with your doctor or pharmacist.
        </footer>
      </div>

      <div className="shrink-0 border-t border-divider bg-bg px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] print:hidden">
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => navigate("/results")}
            className="flex-1 cursor-pointer rounded-2xl bg-surface px-4 py-4 text-[1.05rem] font-semibold text-primary ring-1 ring-divider hover:bg-bg"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl border-none bg-primary px-4 py-4 text-[1.05rem] font-semibold text-white hover:bg-primary-dark"
          >
            <FaPrint size={14} />
            Print / PDF
          </button>
        </div>
      </div>
    </div>
  );
}
