import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FaCamera } from "react-icons/fa";
import { useMedora } from "../context/MedoraContext.jsx";

export default function CameraPage() {
  const captureId = useId();
  const galleryId = useId();
  const captureRef = useRef(null);
  const galleryRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const { extractFromFile, loading, error, clearError } = useMedora();

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const onPick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    clearError();
    setPreviewUrl(URL.createObjectURL(f));
    extractFromFile(f);
  };

  return (
    <div className="flex min-h-[min(100vh-2rem,780px)] flex-1 flex-col bg-camera-bg">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-3">
        <Link
          to="/"
          className="p-1 text-xl leading-none text-slate-200 hover:text-white"
          aria-label="Back to home"
        >
          ←
        </Link>
        <p className="m-0 max-w-[240px] flex-1 rounded-full bg-black/45 px-4 py-[0.45rem] text-center text-[0.8rem] font-medium text-slate-50">
          Point at your medication label
        </p>
        <span className="w-7 shrink-0" aria-hidden />
      </div>

      <div className="relative mb-0 mt-2 flex min-h-[320px] flex-1 items-center justify-center overflow-hidden bg-[#0b1222]">
        {previewUrl ? (
          <img src={previewUrl} alt="" className="h-full min-h-[280px] w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-[0.85rem] text-slate-500">
            <svg viewBox="0 0 64 64" width="48" height="48" fill="none" aria-hidden>
              <path
                d="M8 22h12l4-6h16l4 6h12v28H8V22Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <circle cx="32" cy="38" r="10" stroke="currentColor" strokeWidth="2" />
            </svg>
            <span>Camera viewfinder</span>
          </div>
        )}
        {loading && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/72 text-[0.9rem] font-medium text-slate-100"
            role="status"
          >
            <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
            Reading label…
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-0 mt-2 rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[0.85rem] text-red-700">
          {error}
        </div>
      )}

      <div className="mt-auto flex shrink-0 flex-col items-center gap-4 bg-white px-6 pb-7 pt-5 shadow-[0_-8px_30px_rgba(0,0,0,0.12)]">
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

        <button
          type="button"
          className="flex h-[72px] w-[72px] cursor-pointer items-center justify-center rounded-full border-none bg-primary text-white shadow-[0_6px_24px_rgba(45,122,94,0.45)] transition-transform duration-100 hover:bg-primary-dark active:scale-95 disabled:cursor-not-allowed disabled:opacity-55"
          disabled={loading}
          aria-label="Take photo"
          onClick={() => captureRef.current?.click()}
        >
          <FaCamera className="h-[22px] w-[22px] shrink-0" aria-hidden />
        </button>

        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1.5 border-none bg-transparent p-1.5 text-[0.9rem] font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50"
          disabled={loading}
          onClick={() => galleryRef.current?.click()}
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
      </div>
    </div>
  );
}
