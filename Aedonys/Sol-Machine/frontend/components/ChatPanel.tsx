"use client";

import { useState, useEffect, useRef } from "react";
import type { CarStrategy } from "@/lib/types";

interface ChatMessage {
  author: string;
  text: string;
  ts: number;
}

interface ChatPanelProps {
  carAddress: string;
}

const CORNER_COLOUR: Record<string, string> = {
  safe: "bg-[#0d2a0d] text-[#4c4] border-[#1a4a1a]",
  normal: "bg-[#1a1a0d] text-[#cc4] border-[#3a3a1a]",
  tight: "bg-[#2a0d0d] text-[#f44] border-[#4a1a1a]",
};
const BOOST_COLOUR: Record<string, string> = {
  immediate: "bg-[#2a0d0d] text-[#f44] border-[#4a1a1a]",
  save_straights: "bg-[#0d2a0d] text-[#4c4] border-[#1a4a1a]",
  hold_overtake: "bg-[#1a1a0d] text-[#cc4] border-[#3a3a1a]",
};

function StrategyBadge({ label, value, colourMap }: { label: string; value: string; colourMap: Record<string, string> }) {
  const cls = colourMap[value] ?? "bg-[#1a1a1a] text-[#888] border-[#333]";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 border text-[10px] font-bold tracking-wider ${cls}`}>
      {label}: {value.replace("_", " ")}
    </span>
  );
}

function ThrottleBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const cls = value < 0.4
    ? "bg-[#0d2a0d] text-[#4c4] border-[#1a4a1a]"
    : value < 0.7
    ? "bg-[#1a1a0d] text-[#cc4] border-[#3a3a1a]"
    : "bg-[#2a0d0d] text-[#f44] border-[#4a1a1a]";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 border text-[10px] font-bold tracking-wider ${cls}`}>
      throttle: {pct}%
    </span>
  );
}

export default function ChatPanel({ carAddress }: ChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [strategy, setStrategy] = useState<CarStrategy | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevReasoningRef = useRef("");

  // Poll messages + strategy every 2 s when a car is connected.
  useEffect(() => {
    if (!carAddress) return;
    const poll = async () => {
      try {
        const [msgRes, strRes] = await Promise.all([
          fetch(`/api/chat/messages?car_address=${encodeURIComponent(carAddress)}&limit=50`),
          fetch(`/api/chat/strategy?car_address=${encodeURIComponent(carAddress)}`),
        ]);
        if (msgRes.ok) {
          const d = await msgRes.json();
          setMessages(d.messages ?? []);
          setAnalyzing(d.analyzing ?? false);
        }
        if (strRes.ok) {
          const d = await strRes.json();
          const newStrategy: CarStrategy = {
            throttle_aggressiveness: d.throttle_aggressiveness,
            boost_usage: d.boost_usage,
            corner_behaviour: d.corner_behaviour,
            risk_tolerance: d.risk_tolerance,
            reasoning: d.reasoning ?? "",
          };
          setStrategy(newStrategy);
          setAnalyzing(d.analyzing ?? false);
          // Show toast when reasoning changes (strategy was updated).
          if (d.reasoning && d.reasoning !== prevReasoningRef.current) {
            prevReasoningRef.current = d.reasoning;
            setToast("Strategy updated");
            setTimeout(() => setToast(""), 3000);
          }
        }
      } catch (_) {}
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [carAddress]);

  // Auto-scroll chat to bottom when new messages arrive.
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const sendMessage = async () => {
    if (!text.trim() || !carAddress || sending) return;
    setSending(true);
    try {
      await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          car_address: carAddress,
          author: author.trim() || "Anonymous",
          text: text.trim(),
        }),
      });
      setText("");
    } catch (_) {} finally {
      setSending(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const hasStrategy = strategy !== null;

  return (
    <div className="bg-[#0c0c0c] border-t border-[#1e1e1e] shrink-0">
      {/* Header — always visible */}
      <button
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-[#141414] transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-[11px] text-[#555] tracking-widest">
          {open ? "▲" : "▼"}
        </span>
        <span className="text-[11px] font-bold tracking-widest text-[#888]">
          CROWD STRATEGY
        </span>
        {hasStrategy && (
          <div className="flex items-center gap-1.5 ml-2 flex-wrap">
            <StrategyBadge label="corner" value={strategy!.corner_behaviour} colourMap={CORNER_COLOUR} />
            <StrategyBadge label="boost" value={strategy!.boost_usage} colourMap={BOOST_COLOUR} />
            <ThrottleBadge value={strategy!.throttle_aggressiveness} />
          </div>
        )}
        {analyzing && (
          <span className="ml-auto text-[10px] text-[#ff8800] animate-pulse tracking-wider">
            ■ ANALYZING…
          </span>
        )}
        {toast && !analyzing && (
          <span className="ml-auto text-[10px] text-[#4c4] tracking-wider">{toast}</span>
        )}
        {!carAddress && (
          <span className="ml-auto text-[10px] text-[#444]">connect a car to enable</span>
        )}
      </button>

      {/* Collapsible body */}
      {open && (
        <div className="border-t border-[#1e1e1e]">
          {/* Strategy reasoning */}
          {strategy?.reasoning && (
            <div className="px-4 py-1.5 text-[10px] text-[#555] border-b border-[#1a1a1a] italic">
              {strategy.reasoning}
            </div>
          )}

          {/* Message list */}
          <div className="max-h-40 overflow-y-auto px-4 py-2 flex flex-col gap-1">
            {messages.length === 0 && (
              <span className="text-[11px] text-[#333]">
                No messages yet — be the first to suggest a strategy
              </span>
            )}
            {messages.map((m, i) => (
              <div key={i} className="text-[11px] leading-snug">
                <span className="text-[#ff8800] font-bold">{m.author}</span>
                <span className="text-[#444]">: </span>
                <span className="text-[#aaa]">{m.text}</span>
              </div>
            ))}
            {analyzing && (
              <div className="text-[10px] text-[#ff8800] animate-pulse mt-1">
                ■ Analyzing consensus…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 px-4 py-2 border-t border-[#1a1a1a]">
            <input
              type="text"
              placeholder="Name"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="w-20 bg-[#111] border border-[#2a2a2a] text-[#aaa] text-[11px] px-2 py-1 outline-none focus:border-[#444] font-mono"
              maxLength={20}
            />
            <input
              type="text"
              placeholder="Suggest a strategy…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKey}
              disabled={!carAddress || sending}
              className="flex-1 bg-[#111] border border-[#2a2a2a] text-[#aaa] text-[11px] px-2 py-1 outline-none focus:border-[#444] disabled:opacity-40 font-mono"
              maxLength={200}
            />
            <button
              onClick={sendMessage}
              disabled={!carAddress || !text.trim() || sending}
              className="px-3 py-1 text-[11px] font-bold tracking-wider bg-[#1a1a1a] border border-[#333] text-[#888] hover:border-[#555] hover:text-[#aaa] disabled:opacity-30 transition-colors"
            >
              SEND
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
