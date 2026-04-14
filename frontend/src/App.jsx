import { useCallback, useId, useState } from "react";
import "./App.css";

let rowId = 0;
const nextId = () => ++rowId;

function parseApiError(data, statusText) {
  const d = data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d))
    return d.map((x) => x.msg || JSON.stringify(x)).join("; ");
  return statusText || "Request failed";
}

async function apiJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(parseApiError(data, res.statusText));
  return data;
}

export default function App() {
  const fileInputId = useId();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [result, setResult] = useState(null);

  const goManual = () => {
    setError(null);
    setRows([
      {
        id: nextId(),
        drug_name: "",
        dosage: "",
        normalized: "",
      },
    ]);
    setStep(2);
  };

  const extract = async () => {
    setError(null);
    if (!file) {
      setError("Choose a photo first, or use “Enter drugs manually”.");
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = await apiJson("/api/extract", { method: "POST", body: fd });
      setRows(
        data.items.map((it) => ({
          id: nextId(),
          drug_name: it.drug_name || "",
          dosage: it.dosage || "",
          normalized: it.normalized || "",
        }))
      );
      setStep(2);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const updateRow = useCallback((id, field, value) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  }, []);

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { id: nextId(), drug_name: "", dosage: "", normalized: "" },
    ]);
  };

  const removeRow = (id) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const runAnalyze = async () => {
    setError(null);
    const drugs = rows
      .map((r) => r.normalized.trim())
      .filter(Boolean);
    if (!drugs.length) {
      setError("Add at least one drug name in the “For database lookup” column.");
      return;
    }
    setLoading(true);
    try {
      const data = await apiJson("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drugs }),
      });
      setResult(data);
      setStep(3);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const restart = () => {
    setStep(1);
    setFile(null);
    setRows([]);
    setResult(null);
    setError(null);
  };

  return (
    <div className="medora">
      <h1>Medora</h1>
      <p className="tagline">
        Offline medication safety — photo your bottles, confirm drug names, then
        see interactions and a plain-language summary (Gemma 4 + local database).
      </p>

      <div className="steps">
        <span className={`step-pill ${step === 1 ? "active" : step > 1 ? "done" : ""}`}>
          1 · Photo
        </span>
        <span className={`step-pill ${step === 2 ? "active" : step > 2 ? "done" : ""}`}>
          2 · Confirm drugs
        </span>
        <span className={`step-pill ${step === 3 ? "active" : ""}`}>3 · Results</span>
      </div>

      {error && <div className="error">{error}</div>}

      {step === 1 && (
        <div className="panel">
          <p>
            Upload or capture a photo of one or more medication labels (bottle or
            box).
          </p>
          <div className="capture-row">
            <label className="file-label" htmlFor={fileInputId}>
              {file ? file.name : "Choose image…"}
              <input
                id={fileInputId}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading}
              onClick={extract}
            >
              {loading ? "Reading photo…" : "Extract from photo"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={goManual}
            >
              Enter drugs manually
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="panel">
          <p>
            Review what was read from the photo (if any). Edit the{" "}
            <strong>For database lookup</strong> names so they match your
            medications, then check interactions.
          </p>
          <table className="drug-table">
            <thead>
              <tr>
                <th>From photo (read-only)</th>
                <th>Dosage</th>
                <th>For database lookup</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input
                      value={r.drug_name}
                      readOnly
                      placeholder="—"
                      style={{ background: "#f9fafb" }}
                    />
                  </td>
                  <td>
                    <input
                      value={r.dosage}
                      readOnly
                      placeholder="—"
                      style={{ background: "#f9fafb" }}
                    />
                  </td>
                  <td>
                    <input
                      value={r.normalized}
                      onChange={(e) =>
                        updateRow(r.id, "normalized", e.target.value)
                      }
                      placeholder="e.g. metformin"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => removeRow(r.id)}
                      disabled={rows.length <= 1}
                      aria-label="Remove row"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="toolbar">
            <button type="button" className="btn btn-secondary" onClick={addRow}>
              Add drug
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading}
              onClick={runAnalyze}
            >
              {loading ? "Checking…" : "Check interactions"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading}
              onClick={restart}
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="panel">
          <p>
            <strong>Medications checked:</strong> {result.medications.join(", ")}
          </p>
          <div className="stats">
            {result.major_count > 0 && (
              <span className="stat-major">
                {result.major_count} major interaction
                {result.major_count !== 1 ? "s" : ""}
              </span>
            )}
            {result.moderate_count > 0 && (
              <span className="stat-mod">
                {result.moderate_count} moderate
              </span>
            )}
            {result.interactions.length === 0 && (
              <span>No drug–drug pairs hit in the database.</span>
            )}
          </div>

          <h2>Interactions</h2>
          {result.interactions.length === 0 ? (
            <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>None found.</p>
          ) : (
            <ul className="ix-list">
              {result.interactions.map((ix, i) => (
                <li
                  key={`${ix.drug1}-${ix.drug2}-${i}`}
                  className={
                    ix.severity === "major"
                      ? "sev-major"
                      : ix.severity === "moderate"
                        ? "sev-moderate"
                        : ""
                  }
                >
                  <strong>
                    {ix.drug1} + {ix.drug2}
                  </strong>{" "}
                  ({ix.severity}) — {ix.description}
                  {ix.management ? (
                    <>
                      <br />
                      <em>Management:</em> {ix.management}
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <h2>Beers criteria flags</h2>
          {result.beers_flags.length === 0 ? (
            <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>None for these drugs.</p>
          ) : (
            <ul className="ix-list beers-list">
              {result.beers_flags.map((b, i) => (
                <li key={`${b.drug}-${i}`}>
                  <strong>{b.drug}</strong> ({b.drug_class}) — {b.recommendation}
                  <br />
                  {b.rationale}
                  {b.alternatives ? (
                    <>
                      <br />
                      <em>Alternatives:</em> {b.alternatives}
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <h2>Gemma explanation</h2>
          <div className="explanation">{result.explanation}</div>

          <div className="toolbar">
            <button type="button" className="btn btn-secondary" onClick={restart}>
              New check
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setStep(2);
                setResult(null);
              }}
            >
              Edit drug list
            </button>
          </div>
        </div>
      )}

      <p className="disclaimer">
        Medora is educational, not medical advice. Always talk to your doctor or
        pharmacist. Processing is local (Ollama + SQLite on your machine).
      </p>
    </div>
  );
}
