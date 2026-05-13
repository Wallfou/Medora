import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaFilePdf, FaPlus, FaCamera, FaSyncAlt } from "react-icons/fa";
import { BsChatDots } from "react-icons/bs";
import { useMedora } from "../context/MedoraContext.jsx";
import NormalizationHint from "../components/NormalizationHint.jsx";

const SEVERITY_ORDER = { major: 0, moderate: 1, minor: 2 };

function IconAlertCircle({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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

function rowsToDrugKey(rows) {
  return rows
    .map((r) => (r.normalized || "").trim().toLowerCase())
    .filter(Boolean)
    .slice()
    .sort()
    .join("|");
}

function namesToKey(names) {
  return (names || [])
    .map((n) => (n || "").trim().toLowerCase())
    .filter(Boolean)
    .slice()
    .sort()
    .join("|");
}

export default function ResultsPage() {
  const navigate = useNavigate();
  const {
    rows,
    result,
    loading,
    error,
    updateRow,
    patchRow,
    addRow,
    removeRow,
    analyzeDrugs,
    clearRowNormalization,
    clearError,
  } = useMedora();
  const [openIx, setOpenIx] = useState({});
  const [openBeers, setOpenBeers] = useState({});
  const [focusId, setFocusId] = useState(null);
  const [drugsCollapsed, setDrugsCollapsed] = useState(false);
  const inputRefs = useRef({});

  useEffect(() => {
    if (!rows.length && !result) navigate("/", { replace: true });
  }, [rows.length, result, navigate]);

  useEffect(() => {
    if (focusId && inputRefs.current[focusId]) {
      inputRefs.current[focusId].focus();
      setFocusId(null);
    }
  }, [focusId, rows]);

  const sortedInteractions = useMemo(() => {
    const list = (result?.interactions || []).slice();
    list.sort((a, b) => {
      const sa = SEVERITY_ORDER[a.severity] ?? 99;
      const sb = SEVERITY_ORDER[b.severity] ?? 99;
      return sa - sb;
    });
    return list;
  }, [result]);

  if (!rows.length && !result) return null;

  const nIx = sortedInteractions.length;
  const nBeers = result?.beers_flags?.length || 0;
  const hasDrugs = rows.some((r) => (r.normalized || "").trim());
  const showSafe = result && hasDrugs && nIx === 0 && nBeers === 0;

  const toggleIx = (key) => setOpenIx((p) => ({ ...p, [key]: !p[key] }));
  const toggleBeers = (key) => setOpenBeers((p) => ({ ...p, [key]: !p[key] }));

  const handleAddManual = () => {
    clearError();
    setDrugsCollapsed(false);
    const id = addRow();
    setFocusId(id);
  };

  const handleScanMore = () => {
    clearError();
    navigate("/camera");
  };

  const currentDrugKey = rowsToDrugKey(rows);
  const lastAnalyzedKey = namesToKey(result?.medications);
  const hasPendingConfirmation = rows.some(
    (r) => r.normStatus === "ambiguous" || r.normStatus === "unresolved"
  );
  const isDirty = currentDrugKey !== lastAnalyzedKey || hasPendingConfirmation;

  const handleAnalyze = () => {
    clearError();
    analyzeDrugs();
  };

  const drugCount = rows.length;
  const canAnalyze = hasDrugs && !loading && isDirty;

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-[#f4f4f5] print:bg-white print:overflow-visible">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pt-10 print:overflow-visible print:pb-8 print:pt-2">
        {error && (
          <div className="mb-3 rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[0.85rem] text-red-700">
            {error}
          </div>
        )}

        <div className="rounded-3xl bg-white px-4 pt-4 pb-3 shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
          <button
            type="button"
            onClick={() => setDrugsCollapsed((v) => !v)}
            className="flex w-full cursor-pointer items-center justify-between gap-2 border-none bg-transparent p-0 text-left print:cursor-default"
            aria-expanded={!drugsCollapsed}
            aria-controls="medications-section"
          >
            <h1 className="m-0 text-[1.75rem] font-bold leading-tight tracking-tight text-text">
              Your Medications
              {drugsCollapsed && drugCount > 0 && (
                <span className="ml-2 inline-block text-[1rem] align-top translate-y-2 font-semibold text-muted">
                  ({drugCount})
                </span>
              )}
            </h1>
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              className={`shrink-0 text-muted transition-transform print:hidden ${
                drugsCollapsed ? "" : "rotate-180"
              }`}
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          <section
            id="medications-section"
            className={`mt-4 ${drugsCollapsed ? "hidden print:block" : ""}`}
          >
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-2 rounded-2xl bg-[#f4f4f5] p-3"
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <input
                        ref={(el) => {
                          if (el) inputRefs.current[r.id] = el;
                          else delete inputRefs.current[r.id];
                        }}
                        className="w-full border-none bg-transparent p-0 text-[1.25rem] font-bold text-text placeholder:font-medium placeholder:text-muted-2 focus:outline-none"
                        value={r.normalized}
                        onChange={(e) => {
                          clearError();
                          const v = e.target.value;
                          const reset = { normStatus: null, candidates: [] };
                          if (r.extracted) {
                            patchRow(r.id, { normalized: v, ...reset });
                          } else {
                            patchRow(r.id, {
                              normalized: v,
                              drug_name: v,
                              ...reset,
                            });
                          }
                        }}
                        placeholder="Medication name"
                        autoComplete="off"
                      />
                      <input
                        className="mt-0.5 w-full border-none bg-transparent p-0 text-[0.9rem] text-muted placeholder:text-muted-2 focus:outline-none"
                        value={r.dosage}
                        onChange={(e) => {
                          clearError();
                          updateRow(r.id, "dosage", e.target.value);
                        }}
                        placeholder="Dosage (optional)"
                        autoComplete="off"
                      />
                    </div>
                    <button
                      type="button"
                      className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-red-100 text-red-700 print:hidden"
                      onClick={() => {
                        clearError();
                        removeRow(r.id);
                      }}
                      aria-label={`Remove ${r.normalized || r.drug_name || "medication"}`}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                        <path
                          d="M8 8l8 8M16 8l-8 8"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                  <NormalizationHint
                    row={r}
                    onPick={(name) => {
                      clearError();
                      clearRowNormalization(r.id, name);
                    }}
                  />
                </li>
              ))}
            </ul>

            <div className="mt-2.5 grid grid-cols-3 gap-2 print:hidden">
              <button
                type="button"
                className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-primary/40 bg-white py-3 text-[0.9rem] font-semibold text-primary"
                onClick={handleAddManual}
              >
                <FaPlus className="h-3 w-3" />
                Add
              </button>
              <button
                type="button"
                className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-primary/40 bg-white py-3 text-[0.9rem] font-semibold text-primary"
                onClick={handleScanMore}
              >
                <FaCamera className="h-3.5 w-3.5" />
                Scan
              </button>
              <button
                type="button"
                className={`flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-solid py-3 text-[0.9rem] font-semibold ${
                  canAnalyze
                    ? "cursor-pointer border-primary bg-primary text-white"
                    : "cursor-not-allowed border-gray-300 bg-white text-gray-400"
                }`}
                onClick={handleAnalyze}
                disabled={!canAnalyze}
              >
                <FaSyncAlt className="h-3 w-3" />
                Analyze
              </button>
            </div>
          </section>
        </div>

        {showSafe && (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-3.5">
            <p className="m-0 text-[1.05rem] font-semibold leading-snug text-emerald-900">
              No drug interaction pairs were found in our database for this list. Ask your
              doctor if you are unsure.
            </p>
          </div>
        )}

        {loading && hasDrugs && (
          <div className="mt-3 inline-flex items-center gap-2 text-[0.85rem] text-muted print:hidden">
            <span className="h-3 w-3 animate-spin rounded-full border-[2px] border-primary/30 border-t-primary" />
            Updating analysis…
          </div>
        )}

        {nIx > 0 && (
          <section className="mt-7">
            <h2 className="m-0 px-2 mb-3.5 flex items-center gap-2 text-xl font-bold uppercase tracking-[0.06em]">
              Interactions Issues
            </h2>
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {sortedInteractions.map((ix, i) => {
                const key = `${ix.drug1}-${ix.drug2}-${i}`;
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
                    className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="m-0 text-[1.2rem] font-bold leading-tight text-text">
                        {ix.drug1} + {ix.drug2}
                      </p>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[0.75rem] font-bold uppercase tracking-wide ${
                          isMajor
                            ? "bg-red-800 text-white"
                            : "bg-amber-400 text-amber-800"
                        }`}
                      >
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
            <h2 className="m-0 mb-3.5 text-xl font-bold uppercase tracking-[0.06em]">
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
                    {rec && (
                      <p className="m-0 mt-2 text-[0.95rem] leading-snug text-muted">
                        {rec}
                      </p>
                    )}
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
          <FaFilePdf className="text-white" size={22} />
          Get Doctor Report
        </button>
        <button
          type="button"
          className="inline-flex w-full max-w-full cursor-pointer items-center justify-center gap-2.5 rounded-full border-2 border-primary bg-white px-5 py-3.5 text-[1.05rem] font-bold text-primary"
          onClick={() => navigate("/ask")}
        >
          <BsChatDots className="text-primary" size={20} />
          Ask Questions
        </button>
      </div>
    </div>
  );
}
