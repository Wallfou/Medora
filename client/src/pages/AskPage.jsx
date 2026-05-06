import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowLeft, FaPaperPlane } from "react-icons/fa";
import { useMedora } from "../context/MedoraContext.jsx";
import { apiJson } from "../lib/api.js";

function buildGreeting(meds) {
  if (!meds.length) {
    return "Hi! What would you like to know about your medications?";
  }
  const list =
    meds.length === 1
      ? meds[0]
      : meds.length === 2
        ? `${meds[0]} and ${meds[1]}`
        : `${meds.slice(0, -1).join(", ")}, and ${meds[meds.length - 1]}`;
  return `Hi! I know you're taking ${list}. What would you like to know about your medications?`;
}

export default function AskPage() {
  const navigate = useNavigate();
  const { rows } = useMedora();

  const meds = useMemo(
    () =>
      rows
        .map((r) => (r.normalized || "").trim())
        .filter(Boolean),
    [rows]
  );

  const [messages, setMessages] = useState(() => [
    { role: "assistant", content: buildGreeting(meds) },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const send = async () => {
    const question = input.trim();
    if (!question || sending) return;
    setError(null);
    const nextMessages = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    try {
      const history = nextMessages
        .slice(0, -1)
        .filter((m) => m.role === "user" || m.role === "assistant");
      const data = await apiJson("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          medications: meds,
          history,
        }),
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response || "" },
      ]);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
      if (inputRef.current) inputRef.current.focus();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-[#f4f4f5]">
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-200/80 bg-white px-4 py-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-text"
          aria-label="Back"
        >
          <FaArrowLeft size={18} />
        </button>
        <h1 className="m-0 text-[1.25rem] font-bold tracking-tight text-text">
          Ask Medora
        </h1>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4"
      >
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {messages.map((m, i) => {
            const isUser = m.role === "user";
            return (
              <li
                key={i}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[1rem] leading-snug shadow-[0_1px_2px_rgba(0,0,0,0.06)] ${
                    isUser
                      ? "rounded-br-sm bg-primary text-white"
                      : "rounded-bl-sm bg-white text-text"
                  }`}
                >
                  {m.content}
                </div>
              </li>
            );
          })}
          {sending && (
            <li className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm bg-white px-4 py-3 text-[0.95rem] text-muted shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
                <span className="h-3 w-3 animate-spin rounded-full border-[2px] border-primary/30 border-t-primary" />
                Medora is thinking…
              </div>
            </li>
          )}
        </ul>
        {error && (
          <div className="mt-3 rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[0.85rem] text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-gray-200/80 bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={sending}
            placeholder="Type your question…"
            className="h-14 min-w-0 flex-1 rounded-full border border-gray-200 bg-[#f4f4f5] px-5 text-[1.05rem] text-text placeholder:text-muted-2 focus:border-primary focus:outline-none disabled:opacity-60"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={send}
            disabled={!input.trim() || sending}
            className="flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-primary text-white shadow-[0_4px_14px_rgba(45,122,94,0.35)] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Send"
          >
            <FaPaperPlane size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
