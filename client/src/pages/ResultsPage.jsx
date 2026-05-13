import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaFilePdf, FaPlus, FaCamera, FaSyncAlt } from "react-icons/fa";
import { BsChatDots } from "react-icons/bs";
import { useMedora } from "../context/MedoraContext.jsx";
import NormalizationHint from "../components/NormalizationHint.jsx";

const SEVERITY_ORDER = { major: 0, moderate: 1, minor: 2 };

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

// shape: "name@dosage|name@dosage|..." sorted by name. Including dosage
// means edits to the dose alone mark the analysis dirty, so the patient gets prompted to re analyze
function rowsToDrugKey(rows) {
  return rows
    .map((r) => {
      const name = (r.normalized || "").trim().toLowerCase();
      if (!name) return null;
      const dose = (r.dosage || "").trim().toLowerCase();
      return `${name}@${dose}`;
    })
    .filter(Boolean)
    .slice()
    .sort()
    .join("|");
}

function medsToKey(meds) {
  return (meds || [])
    .map((m) => {
      const name =
        (typeof m === "string" ? m : m?.name || "").trim().toLowerCase();
      if (!name) return null;
      const dose =
        (typeof m === "string" ? "" : m?.dosage || "").trim().toLowerCase();
      return `${name}@${dose}`;
    })
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
  const lastAnalyzedKey = medsToKey(result?.medications);
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
    <div className="flex min-h-screen w-full flex-1 flex-col bg-bg print:bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-8 pb-6 print:overflow-visible print:pb-8 print:pt-2">
        {error && (
          <div className="mb-4 rounded-2xl bg-alert-bg px-4 py-3 text-[1rem] text-alert ring-1 ring-alert/15">
            {error}
          </div>
        )}

        <section className="rounded-2xl bg-surface ring-1 ring-divider">
          <button
            type="button"
            onClick={() => setDrugsCollapsed((v) => !v)}
            className="flex w-full cursor-pointer items-center justify-between gap-2 border-none bg-transparent px-5 py-4 text-left print:cursor-default"
            aria-expanded={!drugsCollapsed}
            aria-controls="medications-section"
          >
            <h1 className="m-0 text-[1.75rem] font-bold leading-tight tracking-tight text-text">
              Your medications
              {drugsCollapsed && drugCount > 0 && (
                <span className="ml-2 text-[1.1rem] font-medium text-muted">
                  ({drugCount})
                </span>
              )}
            </h1>
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
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
            className={`${drugsCollapsed ? "hidden print:block" : ""}`}
          >
            <ul className="m-0 flex list-none flex-col p-0">
              {rows.map((r, i) => (
                <li
                  key={r.id}
                  className={`flex flex-col gap-2 px-5 py-4 ${
                    i > 0 ? "border-t border-divider" : "border-t border-divider"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <input
                        ref={(el) => {
                          if (el) inputRefs.current[r.id] = el;
                          else delete inputRefs.current[r.id];
                        }}
                        className="w-full border-none bg-transparent p-0 text-[1.25rem] font-semibold text-text placeholder:font-medium placeholder:text-muted-2 focus:outline-none"
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
                        className="mt-1 w-full border-none bg-transparent p-0 text-[1rem] text-muted placeholder:text-muted-2 focus:outline-none"
                        value={r.dosage}
                        onChange={(e) => {
                          clearError();
                          updateRow(r.id, "dosage", e.target.value);
                        }}
                        placeholder="Add a dose"
                        autoComplete="off"
                      />
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-full px-3 py-1.5 text-[0.95rem] font-medium text-alert hover:bg-alert-bg print:hidden"
                      onClick={() => {
                        clearError();
                        removeRow(r.id);
                      }}
                      aria-label={`Remove ${r.normalized || r.drug_name || "medication"}`}
                    >
                      Remove
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

            {isDirty && result && !loading && !hasPendingConfirmation && (
              <p className="m-0 border-t border-divider bg-warn-bg px-5 py-3 text-[0.95rem] leading-snug text-warn print:hidden">
                Your medications changed. Tap Analyze to refresh the check.
              </p>
            )}

            <div className="grid grid-cols-3 border-t border-divider print:hidden">
              <button
                type="button"
                className="flex w-full cursor-pointer items-center justify-center gap-2 border-r border-divider bg-transparent py-4 text-[1rem] font-semibold text-primary hover:bg-bg"
                onClick={handleAddManual}
              >
                <FaPlus className="h-3.5 w-3.5" />
                Add
              </button>
              <button
                type="button"
                className="flex w-full cursor-pointer items-center justify-center gap-2 border-r border-divider bg-transparent py-4 text-[1rem] font-semibold text-primary hover:bg-bg"
                onClick={handleScanMore}
              >
                <FaCamera className="h-3.5 w-3.5" />
                Scan
              </button>
              <button
                type="button"
                className={`flex w-full items-center justify-center gap-2 py-4 text-[1rem] font-semibold ${
                  canAnalyze
                    ? "cursor-pointer bg-primary text-white hover:bg-primary-dark"
                    : "cursor-not-allowed bg-transparent text-muted-2"
                }`}
                onClick={handleAnalyze}
                disabled={!canAnalyze}
              >
                <FaSyncAlt className="h-3.5 w-3.5" />
                Analyze
              </button>
            </div>
          </section>
        </section>

        {showSafe && (
          <div className="mt-6 rounded-2xl bg-safe-bg px-5 py-4 ring-1 ring-safe/20">
            <p className="m-0 text-[1.1rem] font-semibold leading-snug text-safe">
              No interactions found
            </p>
            <p className="m-0 mt-1 text-[1rem] leading-snug text-text">
              We didn't find any drug-drug interactions for this list. If
              you're unsure, ask your doctor.
            </p>
          </div>
        )}

        {loading && hasDrugs && (
          <div className="mt-4 inline-flex items-center gap-2 text-[1rem] text-muted print:hidden">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-[2px] border-primary/30 border-t-primary" />
            Updating analysis…
          </div>
        )}

        {nIx > 0 && (
          <section className="mt-8">
            <h2 className="m-0 mb-3 text-[1.5rem] font-bold tracking-tight text-text">
              Interactions
            </h2>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {sortedInteractions.map((ix, i) => {
                const key = `${ix.drug1}-${ix.drug2}-${i}`;
                const isMajor = ix.severity === "major";
                const desc = String(ix.description || "").trim();
                const m = String(ix.management || "").trim();
                const canExpand = Boolean(desc) || Boolean(m);
                const open = openIx[key];
                return (
                  <li
                    key={key}
                    className="overflow-hidden rounded-2xl bg-surface ring-1 ring-divider"
                  >
                    <div className={`flex items-start gap-3 px-5 py-4 ${isMajor ? "bg-alert-bg" : "bg-warn-bg"}`}>
                      <span
                        aria-hidden
                        className={`mt-1.5 inline-block h-3 w-3 shrink-0 rounded-full ${isMajor ? "bg-alert" : "bg-warn"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`m-0 text-[0.95rem] font-semibold uppercase tracking-wide ${isMajor ? "text-alert" : "text-warn"}`}>
                          {isMajor ? "Major concern" : "Moderate concern"}
                        </p>
                        <p className="m-0 mt-1 text-[1.2rem] font-semibold leading-tight text-text">
                          {ix.drug1} <span className="text-muted">+</span> {ix.drug2}
                        </p>
                      </div>
                    </div>
                    {canExpand ? (
                      <div className="px-5 pb-4">
                        <LearnMoreButton
                          id={`ix-more-${i}`}
                          isOpen={open}
                          onClick={() => toggleIx(key)}
                        />
                        {open && (
                          <div
                            className="mt-3 border-t border-divider pt-3 text-[1.05rem] leading-[1.5] text-text"
                            role="region"
                            aria-labelledby={`ix-more-${i}`}
                          >
                            {desc && <p className="m-0 mb-3 text-text">{desc}</p>}
                            {m && (
                              <p className="m-0 text-muted">
                                <span className="font-semibold text-text">What to do: </span>
                                {m}
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

        {nBeers > 0 && (
          <section className="mt-8">
            <h2 className="m-0 mb-3 text-[1.5rem] font-bold tracking-tight text-text">
              Concerns for older adults
            </h2>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
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
                    className="overflow-hidden rounded-2xl bg-surface ring-1 ring-divider"
                  >
                    <div className="flex items-start gap-3 bg-warn-bg px-5 py-4">
                      <span
                        aria-hidden
                        className="mt-1.5 inline-block h-3 w-3 shrink-0 rounded-full bg-warn"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-[0.95rem] font-semibold uppercase tracking-wide text-warn">
                          Age-related caution
                        </p>
                        <p className="m-0 mt-1 text-[1.2rem] font-semibold leading-tight text-text">
                          {b.drug}
                        </p>
                      </div>
                    </div>
                    {rec && (
                      <p className="m-0 px-5 pt-3 text-[1.05rem] leading-snug text-text">
                        {rec}
                      </p>
                    )}
                    {canExpandBeers ? (
                      <div className="px-5 pb-4">
                        <LearnMoreButton
                          id={`beers-more-${i}`}
                          isOpen={open}
                          onClick={() => toggleBeers(key)}
                        />
                        {open && (
                          <div
                            className="mt-3 border-t border-divider pt-3 text-[1.05rem] leading-[1.5] text-text"
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

        <p className="mt-8 text-[0.95rem] leading-snug text-muted-2 print:mt-4">
          Medora is educational and is not medical advice. Talk to your doctor
          or pharmacist before changing anything.
        </p>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-divider bg-bg px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] print:static print:hidden">
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 text-[1.1rem] font-semibold text-white transition-colors hover:bg-primary-dark"
            onClick={() => navigate("/report")}
          >
            <FaFilePdf className="text-white" size={18} />
            Doctor report
          </button>
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-surface px-5 py-4 text-[1.05rem] font-semibold text-primary ring-1 ring-divider hover:bg-bg"
            onClick={() => navigate("/ask")}
          >
            <BsChatDots className="text-primary" size={18} />
            Ask a question
          </button>
        </div>
      </div>
    </div>
  );
}
