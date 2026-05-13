import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FaArrowRight, FaPlus } from "react-icons/fa";
import { useMedora } from "../context/MedoraContext.jsx";

function newPhotoId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function CameraPage() {
  const captureId = useId();
  const galleryId = useId();
  const captureRef = useRef(null);
  const galleryRef = useRef(null);
  const [photos, setPhotos] = useState([]);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const { extractFromFiles, loading, error, clearError, result } = useMedora();
  const backTo = result ? "/results" : "/";

  useEffect(() => {
    return () => {
      for (const p of photosRef.current) URL.revokeObjectURL(p.url);
    };
  }, []);

  const appendPhoto = (file) => {
    const url = URL.createObjectURL(file);
    const id = newPhotoId();
    setPhotos((prev) => [...prev, { id, file, url }]);
  };

  const removePhoto = (id) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((p) => p.id !== id);
    });
  };

  const onPick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    clearError();
    appendPhoto(f);
  };

  const goConfirm = () => {
    if (!photos.length) return;
    extractFromFiles(photos.map((p) => p.file));
  };

  const openCamera = () => captureRef.current?.click();
  const openGallery = () => galleryRef.current?.click();

  return (
    <div className="flex min-h-[min(100vh-2rem,780px)] max-h-[min(100dvh-2rem,900px)] flex-1 flex-col overflow-hidden bg-camera-bg">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-3">
        <Link
          to={backTo}
          className="p-1 text-xl leading-none text-slate-200 hover:text-white"
          aria-label={result ? "Back to dashboard" : "Back to home"}
        >
          ←
        </Link>
        <p className="m-0 max-w-[320px] flex-1 rounded-full bg-black/45 px-6 py-3 text-center text-base font-medium leading-snug text-slate-50">
          Your medication photos
        </p>
        <span className="w-7 shrink-0" aria-hidden />
      </div>

      <input
        ref={captureRef}
        id={captureId}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={onPick}
      />
      <input
        ref={galleryRef}
        id={galleryId}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={onPick}
      />

      <div className="relative mx-4 mb-0 mt-2 min-h-0 flex-1 overflow-y-auto rounded-2xl bg-[#0b1222] p-3">
        {photos.length === 0 ? (
          <button
            type="button"
            onClick={openCamera}
            disabled={loading}
            className="flex h-full min-h-[220px] w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-700 bg-transparent text-slate-400 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg viewBox="0 0 64 64" width="48" height="48" fill="none" aria-hidden>
              <path
                d="M8 22h12l4-6h16l4 6h12v28H8V22Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <circle cx="32" cy="38" r="10" stroke="currentColor" strokeWidth="2" />
            </svg>
            <span className="text-sm font-medium">No photos yet</span>
            <span className="text-xs text-slate-500">Tap to take a photo of a medication label</span>
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((p, index) => (
              <div key={p.id} className="relative aspect-square overflow-hidden rounded-xl bg-slate-800">
                <img src={p.url} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" />
                <span className="absolute bottom-1 left-1 flex h-5 min-w-5 items-center justify-center rounded bg-black/55 px-1 text-[0.65rem] font-semibold text-white">
                  {index + 1}
                </span>
                <button
                  type="button"
                  className="absolute right-1 top-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-0 bg-slate-900/80 text-sm font-bold leading-none text-white shadow-md ring-2 ring-white/70 hover:bg-slate-900 disabled:opacity-50"
                  aria-label={`Remove photo ${index + 1}`}
                  disabled={loading}
                  onClick={() => {
                    clearError();
                    removePhoto(p.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={openCamera}
              disabled={loading}
              className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-600 bg-slate-900/40 text-slate-400 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Add another photo"
            >
              <FaPlus className="h-6 w-6" aria-hidden />
              <span className="text-xs font-medium">Add photo</span>
            </button>
          </div>
        )}
        {loading && (
          <div
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-slate-900/72 text-[0.9rem] font-medium text-slate-100"
            role="status"
          >
            <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
            Reading labels…
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-0 mt-2 rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[0.85rem] text-red-700">
          {error}
        </div>
      )}

      <div className="mt-auto flex shrink-0 flex-col items-stretch gap-3 rounded-t-[20px] bg-white px-4 pb-7 pt-5 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] sm:px-6">
        <button
          type="button"
          className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 border-none bg-transparent py-1 text-[0.9rem] font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50"
          disabled={loading}
          onClick={openGallery}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden>
            <path
              d="M10 4v9m0 0 3-3m-3 3-3-3M4 14v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Upload from photos
        </button>

        <button
          type="button"
          className="inline-flex w-full max-w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-4 text-base font-semibold text-white shadow-[0_6px_20px_rgba(45,122,94,0.35)] transition-transform duration-100 hover:bg-primary-dark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-[0.55]"
          disabled={loading || photos.length === 0}
          onClick={goConfirm}
        >
          {loading ? (
            "Reading labels…"
          ) : (
            <>
              Check these medications
              <FaArrowRight className="h-4 w-4 shrink-0" aria-hidden />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
