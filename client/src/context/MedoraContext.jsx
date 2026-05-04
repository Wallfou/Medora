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

  const runAnalyze = useCallback(async () => {
    setError(null);
    const drugs = rows.map((r) => r.normalized.trim()).filter(Boolean);
    if (!drugs.length) {
      setError("Add at least one medication name for the database lookup.");
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
      navigate("/results");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [navigate, rows]);

  const analyzeDrugs = useCallback(async (drugs) => {
    setError(null);
    if (!drugs.length) {
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
      const data = await apiJson("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drugs }),
      });
      if (myId === analyzeReqRef.current) setResult(data);
    } catch (e) {
      if (myId === analyzeReqRef.current) setError(e.message);
    } finally {
      if (myId === analyzeReqRef.current) setLoading(false);
    }
  }, []);

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
