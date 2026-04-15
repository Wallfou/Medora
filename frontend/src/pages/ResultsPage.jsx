import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMedora } from "../context/MedoraContext.jsx";

export default function ResultsPage() {
  const navigate = useNavigate();
  const { result, restart } = useMedora();

  useEffect(() => {
    if (!result) navigate("/", { replace: true });
  }, [result, navigate]);

  if (!result) return null;

  const editDrugList = () => {
    navigate("/confirm");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gray-50 px-4 pb-8 pt-3">
      <header className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={editDrugList}
          className="cursor-pointer border-none bg-transparent p-1 text-xl leading-none text-primary"
          aria-label="Back to medication list"
        >
          ←
        </button>
        <h1 className="m-0 text-xl font-bold">Your report</h1>
      </header>

      <section className="mb-5">
        <h2 className="mb-1.5 mt-0 text-[0.72rem] font-semibold uppercase tracking-wide text-muted">
          Medications checked
        </h2>
        <p className="mb-3 mt-0 text-[0.95rem] font-medium leading-[1.45]">
          {result.medications.join(", ")}
        </p>
        <div className="flex flex-wrap gap-2">
          {result.major_count > 0 && (
            <span className="rounded-full bg-red-100 px-2.5 py-1.5 text-[0.78rem] font-semibold text-red-800">
              {result.major_count} major
              {result.major_count !== 1 ? " interactions" : " interaction"}
            </span>
          )}
          {result.moderate_count > 0 && (
            <span className="rounded-full bg-orange-100 px-2.5 py-1.5 text-[0.78rem] font-semibold text-orange-900">
              {result.moderate_count} moderate
            </span>
          )}
          {result.interactions.length === 0 && (
            <span className="rounded-full bg-indigo-100 px-2.5 py-1.5 text-[0.78rem] font-semibold text-indigo-900">
              No pairs in database
            </span>
          )}
        </div>
      </section>

      <section className="mb-5">
        <h2 className="mb-2 mt-0 text-base font-bold text-gray-700">Interactions</h2>
        {result.interactions.length === 0 ? (
          <p className="m-0 text-[0.88rem] text-muted">None found.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {result.interactions.map((ix, i) => (
              <li
                key={`${ix.drug1}-${ix.drug2}-${i}`}
                className={`rounded-xl border-l-4 bg-white px-3.5 py-3 text-[0.86rem] shadow-sm ${
                  ix.severity === "major"
                    ? "border-l-red-600"
                    : ix.severity === "moderate"
                      ? "border-l-amber-600"
                      : "border-l-slate-300"
                }`}
              >
                <strong>
                  {ix.drug1} + {ix.drug2}
                </strong>{" "}
                <span className="font-medium text-muted">({ix.severity})</span>
                <p className="mb-0 mt-1.5 text-gray-700">{ix.description}</p>
                {ix.management ? (
                  <p className="mb-0 mt-1.5 text-[0.82rem] text-muted">
                    <em>Management:</em> {ix.management}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-5">
        <h2 className="mb-2 mt-0 text-base font-bold text-gray-700">Beers criteria</h2>
        {result.beers_flags.length === 0 ? (
          <p className="m-0 text-[0.88rem] text-muted">None for these drugs.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {result.beers_flags.map((b, i) => (
              <li
                key={`${b.drug}-${i}`}
                className="rounded-xl border-l-4 border-l-violet-600 bg-white px-3.5 py-3 text-[0.86rem] shadow-sm"
              >
                <strong>{b.drug}</strong>{" "}
                <span className="font-medium text-muted">({b.drug_class})</span>
                <p className="mb-0 mt-1.5 text-gray-700">{b.recommendation}</p>
                <p className="mb-0 mt-1.5 text-[0.82rem] text-muted">{b.rationale}</p>
                {b.alternatives ? (
                  <p className="mb-0 mt-1.5 text-[0.82rem] text-muted">
                    <em>Alternatives:</em> {b.alternatives}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-5">
        <h2 className="mb-2 mt-0 text-base font-bold text-gray-700">Explanation</h2>
        <div className="whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-4 text-[0.88rem] leading-[1.55]">
          {result.explanation}
        </div>
      </section>

      <div className="mt-4 flex flex-col gap-2.5">
        <button
          type="button"
          className="w-full cursor-pointer rounded-xl border border-gray-300 bg-white px-4 py-3 text-[0.9rem] font-semibold text-gray-700 hover:bg-gray-50"
          onClick={editDrugList}
        >
          Edit drug list
        </button>
        <button
          type="button"
          className="inline-flex w-full max-w-full items-center justify-center gap-2.5 rounded-full bg-primary px-6 py-4 text-base font-semibold text-white shadow-[0_6px_20px_rgba(45,122,94,0.35)] transition-transform duration-100 hover:bg-primary-dark active:scale-[0.98]"
          onClick={restart}
        >
          New check
        </button>
      </div>

      <p className="mx-auto mt-6 max-w-none text-[0.72rem] leading-snug text-muted-2">
        Medora is educational, not medical advice. Always talk to your doctor or pharmacist.
      </p>
    </div>
  );
}
