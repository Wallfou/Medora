export default function NormalizationHint({ row, onPick }) {
  const status = row.normStatus;
  const candidates = row.candidates || [];
  if (status !== "ambiguous" && status !== "unresolved") return null;

  const heading =
    status === "ambiguous"
      ? "Did you mean…"
      : candidates.length
      ? "Not a confident match — closest options:"
      : "We couldn't find this in our database.";

  return (
    <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2">
      <p className="m-0 text-[0.75rem] font-semibold text-amber-800">
        {heading}
      </p>
      {candidates.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {candidates.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => onPick(c.name)}
              className="cursor-pointer rounded-full border border-amber-300 bg-white px-2.5 py-1 text-[0.8rem] font-medium text-amber-900 hover:bg-amber-100"
              title={`${c.score}% match`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      {status === "unresolved" && (
        <p className="m-0 mt-1.5 text-[0.72rem] text-amber-700">
          Check the spelling, or pick a suggestion above if it looks right.
        </p>
      )}
    </div>
  );
}
