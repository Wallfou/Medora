import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMedora } from "../context/MedoraContext.jsx";

function IconAlertCircle({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconDocument({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M7 3h6l4 4v12a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M13 3v4h4" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8.5 13h7M8.5 16h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function LearnMoreButton({ isOpen, onClick, id }) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      className="mt-3 inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[1.05rem] font-semibold text-primary no-underline"
      aria-expanded={isOpen}
      aria-label={isOpen ? "Hide details" : "Show more details"}
    >
      <span>{isOpen ? "Show less" : "Learn more"}</span>
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        className={`shrink-0 text-primary transition-transform ${isOpen ? "rotate-180" : ""}`}
        aria-hidden
      >
        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export default function ResultsPage() {
  const navigate = useNavigate();
  const { result, restart } = useMedora();
  const [openIx, setOpenIx] = useState(() => ({}));
  const [openBeers, setOpenBeers] = useState(() => ({}));

  useEffect(() => {
    if (!result) navigate("/", { replace: true });
  }, [result, navigate]);

  const interactionKeys = useMemo(
    () =>
      (result?.interactions || []).map(
        (ix, i) => `${ix.drug1}-${ix.drug2}-${i}`
      ) || [],
    [result]
  );

  if (!result) return null;

  const nIx = result.interactions.length;
  const nBeers = result.beers_flags.length;
  const hasSummary = Boolean(result.explanation && String(result.explanation).trim());

  const editDrugList = () => {
    navigate("/confirm");
  };

  const toggleIx = (key) => {
    setOpenIx((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleBeers = (key) => {
    setOpenBeers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-[#f4f4f5] print:bg-white print:overflow-visible">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 print:overflow-visible print:pb-8 print:pt-2">
        <header className="mb-2 flex items-start gap-2 print:hidden">
          <button
            type="button"
            onClick={editDrugList}
            className="cursor-pointer border-none bg-transparent p-1.5 text-2xl leading-none text-primary"
            aria-label="Back to medication list"
          >
            ←
          </button>
        </header>

        <h1 className="m-0 text-[1.75rem] font-bold leading-tight tracking-tight text-text">
          Your Medication Check
        </h1>

        {nIx > 0 && (
          <div
            className="mt-4 flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3.5"
            role="status"
          >
            <IconAlertCircle className="mt-0.5 shrink-0 text-red-600" />
            <p className="m-0 text-[1.1rem] font-bold leading-snug text-red-800">
              {nIx === 1
                ? "1 interaction needs attention"
                : `${nIx} interactions need attention`}
            </p>
          </div>
        )}

        {nIx === 0 && nBeers > 0 && (
          <div
            className="mt-4 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3.5"
            role="status"
          >
            <p className="m-0 text-[1.1rem] font-bold leading-snug text-amber-900">
              {nBeers === 1
                ? "1 age-related note to review"
                : `${nBeers} age-related notes to review`}
            </p>
          </div>
        )}

        {nIx === 0 && nBeers === 0 && (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-3.5">
            <p className="m-0 text-[1.05rem] font-semibold leading-snug text-emerald-900">
              No drug interaction pairs were found in our database for this list. Ask your
              doctor if you are unsure.
            </p>
          </div>
        )}

        {nIx > 0 && (
          <section className="mt-7">
            <h2 className="m-0 mb-3.5 text-[0.7rem] font-bold uppercase tracking-[0.12em] text-muted-2">
              Interactions
            </h2>
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {result.interactions.map((ix, i) => {
                const key = interactionKeys[i];
                const isMajor = ix.severity === "major";
                const label = isMajor
                  ? "Major"
                  : ix.severity === "moderate"
                    ? "Moderate"
                    : (ix.severity || "—").toString();
                const desc = String(ix.description || "").trim();
                const m = String(ix.management || "").trim();
                const canExpand = Boolean(desc) || Boolean(m);
                const open = openIx[key];
                return (
                  <li
                    key={key}
                    className="rounded-2xl border border-gray-200/80 border-l-4 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
                    style={{ borderLeftColor: isMajor ? "#dc2626" : "#d97706" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="m-0 text-[1.2rem] font-bold leading-tight text-text">
                        {ix.drug1} + {ix.drug2}
                      </p>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[0.75rem] font-bold uppercase tracking-wide ${
                          isMajor
                            ? "bg-red-100 text-red-800"
                            : "bg-amber-100 text-amber-900"
                        }`}
                      >
                        {isMajor && <IconAlertCircle className="h-3.5 w-3.5 text-red-600" />}
                        {label}
                      </span>
                    </div>
                    {canExpand ? (
                      <>
                        <LearnMoreButton
                          id={`ix-more-${i}`}
                          isOpen={open}
                          onClick={() => toggleIx(key)}
                        />
                        {open && (
                          <div
                            className="mt-2 border-t border-gray-100 pt-3 text-[0.98rem] leading-[1.5] text-text"
                            role="region"
                            aria-labelledby={`ix-more-${i}`}
                          >
                            {desc && <p className="m-0 mb-2 text-text">{desc}</p>}
                            {m && (
                              <p className="m-0 text-muted">
                                <span className="font-semibold text-text">What to do: </span>
                                {m}
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {nBeers > 0 && (
          <section className="mt-8">
            <h2 className="m-0 mb-3.5 text-[0.7rem] font-bold uppercase tracking-[0.12em] text-muted-2">
              Age-Related Considerations
            </h2>
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {result.beers_flags.map((b, i) => {
                const key = `beers-${b.drug}-${i}`;
                const open = openBeers[key];
                const rec = String(b.recommendation || "").trim();
                const canExpandBeers =
                  Boolean(rec) ||
                  Boolean(b.rationale && String(b.rationale).trim()) ||
                  Boolean(b.drug_class && String(b.drug_class).trim()) ||
                  Boolean(b.alternatives && String(b.alternatives).trim());
                return (
                  <li
                    key={key}
                    className="rounded-2xl border border-gray-200/80 border-l-4 border-l-amber-500 bg-white p-4 pl-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
                  >
                    <div className="flex items-start gap-2.5">
                      <p className="m-0 flex-1 text-[1.2rem] font-bold leading-tight text-text">
                        {b.drug}
                      </p>
                    </div>
                    {canExpandBeers ? (
                      <div>
                        <LearnMoreButton
                          id={`beers-more-${i}`}
                          isOpen={open}
                          onClick={() => toggleBeers(key)}
                        />
                        {open && (
                          <div
                            className="mt-2 border-t border-gray-100 pt-3 text-[0.98rem] leading-[1.5] text-text"
                            role="region"
                            aria-labelledby={`beers-more-${i}`}
                          >
                            {rec && <p className="m-0 mb-2 text-text">{rec}</p>}
                            {b.rationale && String(b.rationale).trim() && (
                              <p className="m-0 mb-2 text-muted">
                                <span className="font-semibold text-text">Why: </span>
                                {b.rationale}
                              </p>
                            )}
                            {b.drug_class && String(b.drug_class).trim() && (
                              <p className="m-0 mb-2 text-muted">
                                <span className="font-semibold text-text">Type: </span>
                                {b.drug_class}
                              </p>
                            )}
                            {b.alternatives && String(b.alternatives).trim() && (
                              <p className="m-0 text-muted">
                                <span className="font-semibold text-text">Alternatives: </span>
                                {b.alternatives}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <p className="mt-6 text-[0.8rem] leading-snug text-muted-2 print:mt-4">
          Medora is educational, not medical advice. Always talk to your doctor or pharmacist.
        </p>
      </div>

      <div className="shrink-0 border-t border-gray-200/80 bg-[#f4f4f5] bg-[linear-gradient(to_top,#f4f4f5_92%,transparent)] px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] print:hidden">
        <button
          type="button"
          className="mb-2.5 inline-flex w-full max-w-full cursor-pointer items-center justify-center gap-2.5 rounded-full bg-primary px-5 py-4 text-[1.12rem] font-bold text-white shadow-[0_6px_20px_rgba(45,122,94,0.3)]"
          onClick={() => window.print()}
        >
          <IconDocument className="text-white" />
          Get Doctor Report
        </button>
        <div className="flex flex-col gap-1.5 pb-1 text-center text-[0.95rem]">
          <button
            type="button"
            onClick={editDrugList}
            className="cursor-pointer border-none bg-transparent py-1.5 font-semibold text-primary"
          >
            Edit drug list
          </button>
          <button
            type="button"
            onClick={restart}
            className="cursor-pointer border-none bg-transparent py-1.5 font-semibold text-muted"
          >
            New check
          </button>
        </div>
      </div>
    </div>
  );
}
