import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { apiJson } from "../lib/api.js";

let rowId = 0;
const nextId = () => ++rowId;

const MedoraContext = createContext(null);

export function MedoraProvider({ children }) {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [result, setResult] = useState(null);

  const goManual = useCallback(() => {
    setError(null);
    setFile(null);
    setResult(null);
    setRows([
      {
        id: nextId(),
        drug_name: "",
        dosage: "",
        normalized: "",
      },
    ]);
    navigate("/confirm");
  }, [navigate]);

  const extractFromFile = useCallback(
    async (imageFile) => {
      if (!imageFile) {
        setError("Choose a photo first.");
        return;
      }
      setError(null);
      setLoading(true);
      try {
        const fd = new FormData();
        fd.append("file", imageFile);
        const data = await apiJson("/api/extract", { method: "POST", body: fd });
        setFile(imageFile);
        setRows(
          data.items.map((it) => ({
            id: nextId(),
            drug_name: it.drug_name || "",
            dosage: it.dosage || "",
            normalized: it.normalized || "",
          }))
        );
        navigate("/confirm");
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [navigate]
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
    setRows((prev) => [
      ...prev,
      { id: nextId(), drug_name: "", dosage: "", normalized: "" },
    ]);
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

  const restart = useCallback(() => {
    setFile(null);
    setRows([]);
    setResult(null);
    setError(null);
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
      updateRow,
      patchRow,
      addRow,
      removeRow,
      runAnalyze,
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
      updateRow,
      patchRow,
      addRow,
      removeRow,
      runAnalyze,
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
