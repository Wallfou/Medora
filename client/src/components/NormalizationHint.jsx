export default function NormalizationHint({ row, onPick }) {
  const status = row.normStatus;
  const candidates = row.candidates || [];
  if (status !== "ambiguous" && status !== "unresolved") return null;

  const heading =
    status === "ambiguous"
      ? "Did you mean…"
      : candidates.length
      ? "We couldn't find an exact match. Closest options:"
      : "We couldn't find this in our records.";

  return (
    <div className="mt-3 rounded-xl bg-warn-bg px-3.5 py-3 ring-1 ring-warn/15">
      <p className="m-0 text-[0.95rem] font-semibold text-warn">{heading}</p>
      {candidates.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {candidates.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => onPick(c.name)}
              className="cursor-pointer rounded-full bg-white px-3.5 py-1.5 text-[0.95rem] font-medium text-text ring-1 ring-divider hover:bg-bg"
              title={`${c.score}% match`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      {status === "unresolved" && (
        <p className="m-0 mt-2 text-[0.9rem] leading-snug text-muted">
          Check the spelling, or pick a suggestion above if it looks right.
        </p>
      )}
    </div>
  );
}
