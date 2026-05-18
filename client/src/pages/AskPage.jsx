import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowLeft, FaPaperPlane } from "react-icons/fa";
import ReactMarkdown from "react-markdown";
import { useMedora } from "../context/MedoraContext.jsx";
import { parseApiError } from "../lib/api.js";

function buildOpener() {
  return "Ask anything about your medications.";
}

export default function AskPage() {
  const navigate = useNavigate();
  const { rows } = useMedora();

  // {name, dosage} objects -- backend uses dosage in the chat system prompt
  // so questions can be answered with patient's dosage information
  const meds = useMemo(
    () =>
      rows
        .map((r) => ({
          name: (r.normalized || "").trim(),
          dosage: (r.dosage || "").trim(),
        }))
        .filter((m) => m.name),
    [rows]
  );

  const [messages, setMessages] = useState(() => [
    { role: "assistant", content: buildOpener() },
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

  // (for mobile: keyboard pushes header upwards)
  // Track the visual viewport so the page height 
  // matches the visible area and pin document scroll to 0.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const update = () => {
      root.style.setProperty("--app-vh", `${vv.height}px`);
      window.scrollTo(0, 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--app-vh");
      document.body.style.overflow = prevBodyOverflow;
    };
  }, []);

  const send = async () => {
    const question = input.trim();
    if (!question || sending) return;
    setError(null);
    const baseMessages = [...messages, { role: "user", content: question }];
    setMessages(baseMessages);
    setInput("");
    setSending(true);

    try {
      const history = baseMessages
        .slice(0, -1)
        .filter((m) => m.role === "user" || m.role === "assistant");

      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, medications: meds, history }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(parseApiError(data, res.statusText));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let appended = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const piece = decoder.decode(value, { stream: true });
        if (!piece) continue;
        buffer += piece;
        if (!appended) {
          appended = true;
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: buffer },
          ]);
        } else {
          setMessages((prev) => {
            const next = prev.slice();
            next[next.length - 1] = { role: "assistant", content: buffer };
            return next;
          });
        }
      }

      const tail = decoder.decode();
      if (tail) {
        buffer += tail;
        setMessages((prev) => {
          const next = prev.slice();
          if (!appended) {
            return [...prev, { role: "assistant", content: buffer }];
          }
          next[next.length - 1] = { role: "assistant", content: buffer };
          return next;
        });
        appended = true;
      }

      // empty stream: still surface something so the chat doesn't look frozen
      if (!appended) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "" },
        ]);
      }

      // Detect server side error sentinel emitted after streaming started
      const errMatch = buffer.match(/\[ERROR\]\s*(.+)$/);
      if (errMatch) setError(errMatch[1].trim());
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
    <div
      className="flex w-full flex-1 flex-col overflow-hidden bg-bg"
      style={{ height: "var(--app-vh, 100dvh)", maxHeight: "var(--app-vh, 100dvh)" }}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-divider bg-bg px-4 py-2 sm:py-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-text hover:bg-divider sm:h-10 sm:w-10"
          aria-label="Back"
        >
          <FaArrowLeft size={18} />
        </button>
        <h1 className="m-0 text-xl font-bold tracking-tight text-text sm:text-[1.35rem]">
          Ask Medora
        </h1>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 sm:px-5 sm:py-5"
      >
        <ul className="m-0 flex list-none flex-col gap-3 p-0 sm:gap-4">
          {messages.map((m, i) => {
            const isUser = m.role === "user";
            const text = (m.content || "").trim();
            const display = text || "(no response — please try again)";
            return (
              <li
                key={i}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] min-w-0 break-words rounded-2xl px-4 py-3 text-[1.05rem] leading-snug ${
                    isUser
                      ? "rounded-br-md bg-primary text-white"
                      : `rounded-bl-md bg-surface ring-1 ring-divider ${text ? "text-text" : "text-muted italic"}`
                  }`}
                >
                  {isUser ? (
                    <span className="whitespace-pre-wrap">{display}</span>
                  ) : (
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="m-0 mb-2 last:mb-0">{children}</p>,
                        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                        ul: ({ children }) => <ul className="my-1 ml-5 list-disc">{children}</ul>,
                        ol: ({ children }) => <ol className="my-1 ml-5 list-decimal">{children}</ol>,
                        li: ({ children }) => <li className="mb-1">{children}</li>,
                      }}
                    >
                      {display}
                    </ReactMarkdown>
                  )}
                </div>
              </li>
            );
          })}
          {sending && messages[messages.length - 1]?.role === "user" && (
            <li className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md bg-surface px-4 py-3 text-[1rem] text-muted ring-1 ring-divider">
                <span className="h-3 w-3 animate-spin rounded-full border-[2px] border-primary/30 border-t-primary" />
                Thinking…
              </div>
            </li>
          )}
        </ul>
        {error && (
          <div className="mt-4 rounded-2xl bg-alert-bg px-4 py-3 text-[1rem] text-alert ring-1 ring-alert/15">
            {error}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-divider bg-bg px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] sm:pt-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={sending}
            placeholder="Type your question…"
            className="h-12 min-w-0 flex-1 rounded-2xl bg-surface px-4 text-base text-text ring-1 ring-divider placeholder:text-muted-2 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 sm:h-14 sm:px-5 sm:text-[1.1rem]"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={send}
            disabled={!input.trim() || sending}
            className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl border-none bg-primary text-white disabled:cursor-not-allowed disabled:opacity-40 sm:h-14 sm:w-14"
            aria-label="Send"
          >
            <FaPaperPlane size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
