import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { apiJson } from "../lib/api.js";

let rowId = 0;
const nextId = () => ++rowId;

const STORAGE_KEY = "medora.dashboard.v1";

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { rows: [], result: null };
    const parsed = JSON.parse(raw);
    return {
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
      result: parsed.result || null,
    };
  } catch {
    return { rows: [], result: null };
  }
}

const MedoraContext = createContext(null);

export function MedoraProvider({ children }) {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const initial = useMemo(() => loadStored(), []);
  const [rows, setRows] = useState(() => {
    for (const r of initial.rows) {
      if (typeof r.id === "number" && r.id > rowId) rowId = r.id;
    }
    return initial.rows;
  });
  const [result, setResult] = useState(() => initial.result);
  const analyzeReqRef = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ rows, result }));
    } catch {
      /* ignore */
    }
  }, [rows, result]);

  const goManual = useCallback(() => {
    setError(null);
    setFile(null);
    setResult(null);
    setRows([
      {
        id: nextId(),
        extracted: false,
        drug_name: "",
        dosage: "",
        normalized: "",
      },
    ]);
    navigate("/confirm");
  }, [navigate]);

  const extractFromFiles = useCallback(
    async (imageFiles) => {
      if (!imageFiles?.length) {
        setError("Add at least one photo first.");
        return;
      }
      setError(null);
      setLoading(true);
      try {
        const merged = [];
        for (const imageFile of imageFiles) {
          const fd = new FormData();
          fd.append("file", imageFile);
          const data = await apiJson("/api/extract", { method: "POST", body: fd });
          for (const it of data.items || []) {
            merged.push({
              id: nextId(),
              extracted: true,
              drug_name: it.drug_name || "",
              dosage: it.dosage || "",
              normalized: it.normalized || "",
            });
          }
        }
        if (!merged.length) {
          setError("No medication names were found on those photos. Try clearer photos or add names manually from the home screen.");
          return;
        }
        setFile(imageFiles[0]);
        setRows((prev) => (result && prev.length ? [...prev, ...merged] : merged));
        navigate("/confirm");
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [navigate, result]
  );

  const extractFromFile = useCallback(
    async (imageFile) => extractFromFiles(imageFile ? [imageFile] : []),
    [extractFromFiles]
  );

  const updateRow = useCallback((id, field, value) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  }, []);

  const patchRow = useCallback((id, patch) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }, []);

  const addRow = useCallback(() => {
    const id = nextId();
    setRows((prev) => [
      ...prev,
      { id, extracted: false, drug_name: "", dosage: "", normalized: "" },
    ]);
    return id;
  }, []);

  const removeRow = useCallback((id) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const clearRowNormalization = useCallback((id, resolvedName) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              normalized: resolvedName,
              normStatus: "resolved",
              candidates: [],
            }
          : r
      )
    );
  }, []);

  // Normalize the given rows against the DB and write status/candidates back.
  // Returns { ok: true, drugs } when every row resolved confidently, or
  // { ok: false } when one or more need user confirmation
  // caller should bail out of analyze).
  const normalizeAndApply = useCallback(async (activeRows) => {
    const normData = await apiJson("/api/normalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        medications: activeRows.map((r) => r.normalized.trim()),
      }),
    });

    const resultsByIndex = normData.results || [];
    let needsConfirmation = false;
    const idToUpdate = new Map();
    activeRows.forEach((r, i) => {
      const out = resultsByIndex[i];
      if (!out) return;
      if (out.status === "resolved") {
        idToUpdate.set(r.id, {
          normalized: out.resolved || r.normalized,
          normStatus: "resolved",
          candidates: [],
        });
      } else {
        needsConfirmation = true;
        idToUpdate.set(r.id, {
          normStatus: out.status,
          candidates: out.candidates || [],
        });
      }
    });

    setRows((prev) =>
      prev.map((r) =>
        idToUpdate.has(r.id) ? { ...r, ...idToUpdate.get(r.id) } : r
      )
    );

    if (needsConfirmation) return { ok: false };

    const drugs = activeRows
      .map((r) => (idToUpdate.get(r.id)?.normalized || r.normalized).trim())
      .filter(Boolean);
    return { ok: true, drugs };
  }, []);

  const runAnalyze = useCallback(async () => {
    setError(null);
    const activeRows = rows.filter((r) => r.normalized && r.normalized.trim());
    if (!activeRows.length) {
      setError("Add at least one medication name for the database lookup.");
      return;
    }

    setLoading(true);
    try {
      const norm = await normalizeAndApply(activeRows);
      if (!norm.ok) {
        setError(
          "We couldn't confidently match one or more medications. Please pick the closest match below."
        );
        return;
      }

      const data = await apiJson("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drugs: norm.drugs }),
      });
      setResult(data);
      navigate("/results");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [navigate, rows, normalizeAndApply]);

  // Re-analyze the current rows in place -> runAnalyze but no navigation
  // and uses the analyzeReqRef de-dupe so rapid edits don't clobber each other. 
  const analyzeDrugs = useCallback(async () => {
    setError(null);
    const activeRows = rows.filter((r) => r.normalized && r.normalized.trim());
    if (!activeRows.length) {
      analyzeReqRef.current++;
      setResult({
        medications: [],
        interactions: [],
        beers_flags: [],
        explanation: "",
        major_count: 0,
        moderate_count: 0,
      });
      return;
    }
    const myId = ++analyzeReqRef.current;
    setLoading(true);
    try {
      const norm = await normalizeAndApply(activeRows);
      if (myId !== analyzeReqRef.current) return;
      if (!norm.ok) {
        setError(
          "We couldn't confidently match one or more medications. Please pick the closest match below."
        );
        return;
      }
      const data = await apiJson("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drugs: norm.drugs }),
      });
      if (myId === analyzeReqRef.current) setResult(data);
    } catch (e) {
      if (myId === analyzeReqRef.current) setError(e.message);
    } finally {
      if (myId === analyzeReqRef.current) setLoading(false);
    }
  }, [rows, normalizeAndApply]);

  const restart = useCallback(() => {
    setFile(null);
    setRows([]);
    setResult(null);
    setError(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    navigate("/");
  }, [navigate]);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo(
    () => ({
      file,
      setFile,
      loading,
      error,
      setError,
      clearError,
      rows,
      setRows,
      result,
      setResult,
      goManual,
      extractFromFile,
      extractFromFiles,
      updateRow,
      patchRow,
      addRow,
      removeRow,
      runAnalyze,
      analyzeDrugs,
      clearRowNormalization,
      restart,
    }),
    [
      file,
      loading,
      error,
      clearError,
      rows,
      result,
      goManual,
      extractFromFile,
      extractFromFiles,
      updateRow,
      patchRow,
      addRow,
      removeRow,
      runAnalyze,
      analyzeDrugs,
      clearRowNormalization,
      restart,
    ]
  );

  return (
    <MedoraContext.Provider value={value}>{children}</MedoraContext.Provider>
  );
}

export function useMedora() {
  const ctx = useContext(MedoraContext);
  if (!ctx) throw new Error("useMedora must be used within MedoraProvider");
  return ctx;
}
