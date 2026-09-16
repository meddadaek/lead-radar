import { ArrowUp, Check, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { EMAIL_LABEL, engine, scoreTone, store } from "../lib/data";
import type { ChatJob, LeadBrief, UiAction } from "../lib/types";
import { EASE, Hud, Kbd, SCORE_COLOR } from "./ui";

interface Msg {
  role: "user" | "assistant";
  content: string;
  steps?: ChatJob["steps"];
  leads?: LeadBrief[];
  done?: string[];
  error?: boolean;
}

type AppPage = "overview" | "leads" | "searches" | "settings";

const KEY = "leadradar:chat:v1";
const SUGGESTIONS = [
  "Show my 5 best leads with a verified email",
  "Find 20 dental clinics in Marseille",
  "How are my searches going?",
  "Which leads have no website?",
];

function load(): Msg[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

/** Minimal formatting: line breaks and **bold**. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith("**") && part.endsWith("**")
              ? <strong key={j} className="font-semibold text-text">{part.slice(2, -2)}</strong>
              : <Fragment key={j}>{part}</Fragment>,
          )}
        </Fragment>
      ))}
    </>
  );
}

function describe(a: UiAction): string {
  switch (a.type) {
    case "navigate": return `Opened ${a.page}`;
    case "open_lead": return "Opened the lead";
    case "filter_leads": return "Filtered the lead list";
    case "set_status": return `Marked ${a.lead_ids.length} lead${a.lead_ids.length > 1 ? "s" : ""} ${a.status.replace("_", " ")}`;
  }
}

export function AgentChat({
  onNavigate, onOpenLead, onFilter, onLeadsChanged, drawerOpen,
}: {
  onNavigate: (page: AppPage) => void;
  onOpenLead: (id: string) => void;
  onFilter: (filters: Record<string, string | number>) => void;
  onLeadsChanged: () => void;
  drawerOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(load);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<ChatJob["steps"]>([]);
  const [agentReady, setAgentReady] = useState<boolean | null>(null);
  const [model, setModel] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* storage blocked: conversation stays in memory */
    }
  }, [messages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    engine.keys().then((k) => setAgentReady(k.agent)).catch(() => setAgentReady(false));
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, live, open]);

  const apply = useCallback((actions: UiAction[]) => {
    const done: string[] = [];
    for (const a of actions) {
      if (a.type === "navigate") onNavigate(a.page);
      else if (a.type === "open_lead") onOpenLead(a.lead_id);
      else if (a.type === "filter_leads") onFilter(a.filters);
      else if (a.type === "set_status") store.setStatus(a.lead_ids, a.status);
      done.push(describe(a));
    }
    return done;
  }, [onNavigate, onOpenLead, onFilter]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const history: Msg[] = [...messages, { role: "user", content }];
    setMessages(history);
    setInput("");
    setBusy(true);
    setLive([]);
    try {
      // outreach statuses live in this browser, so the agent gets them with every turn
      const statuses = Object.fromEntries(
        Object.entries(store.get().overrides).filter(([, o]) => o.status).map(([id, o]) => [id, String(o.status)]),
      );
      const { job_id } = await engine.chat(history.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })), statuses);
      let job: ChatJob;
      for (;;) {
        await new Promise((r) => setTimeout(r, 900));
        job = await engine.chatStatus(job_id);
        setLive(job.steps);
        if (job.state !== "running") break;
      }
      if (job.state === "error") throw new Error(job.error || "The agent stopped");
      if (job.model) setModel(job.model);
      const done = apply(job.ui);
      if (job.tools.some((t) => t === "start_search" || t === "research_lead")) onLeadsChanged();
      setMessages((m) => [...m, { role: "assistant", content: job.reply, steps: job.steps, leads: job.leads, done }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
      setLive([]);
    }
  };

  // slide left when a lead panel is open on the right, so both stay visible
  const right = drawerOpen ? "min(584px, calc(100vw - 446px))" : "24px";

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            key="orb"
            initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}
            whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-6 right-6 z-[1100] grid h-14 w-14 cursor-pointer place-items-center overflow-hidden rounded-full border border-accent/40 bg-[#0b0f18]/90 shadow-[0_0_40px_-6px_var(--accent)] backdrop-blur-xl"
            aria-label="Talk to Radar (Ctrl J)"
            title="Talk to Radar (Ctrl J)"
          >
            <span className="radar-sweep absolute inset-1.5 rounded-full" style={{ background: "conic-gradient(from 0deg, rgba(200,245,66,.35), transparent 80deg)" }} />
            <Sparkles className="relative h-5 w-5 text-accent-text" />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.section
            key="panel"
            initial={{ opacity: 0, y: 30, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.45, ease: EASE }}
            style={{ right }}
            className="glass brackets fixed bottom-6 z-[1100] flex h-[min(680px,calc(100vh-48px))] w-[min(430px,calc(100vw-32px))] flex-col overflow-hidden rounded-[26px] !bg-[#070a12]/95 transition-[right] duration-500"
          >
            <span className="br tl" /><span className="br tr" /><span className="br bl" /><span className="br brr" />
            <header className="flex items-center gap-3 border-b border-line px-4 py-3">
              <div className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl border border-accent/30 bg-accent/[0.08]">
                <span className={`radar-sweep absolute inset-0 ${busy ? "" : "opacity-40"}`} style={{ background: "conic-gradient(from 0deg, rgba(200,245,66,.45), transparent 90deg)" }} />
                <Sparkles className="relative h-4 w-4 text-accent-text" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold tracking-tight">Radar</div>
                <div className="hud truncate !text-[8.5px]">{busy ? "working…" : model ? `AI operator · ${model}` : "AI operator"}</div>
              </div>
              {messages.length > 0 && (
                <button onClick={() => setMessages([])} disabled={busy} className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-faint transition hover:bg-white/[0.06] hover:text-text disabled:opacity-30" title="New conversation" aria-label="New conversation">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-muted transition hover:bg-white/[0.06] hover:text-text" aria-label="Close chat">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div ref={scroller} className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {agentReady === false && (
                <div className="rounded-xl border border-violet/30 bg-violet/[0.06] px-3 py-2.5 text-[12.5px] text-muted">
                  Radar needs your Groq key.
                  <button onClick={() => onNavigate("settings")} className="ml-1 cursor-pointer text-accent-text hover:underline">Open API keys</button>
                </div>
              )}
              {messages.length === 0 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                  <Hud accent>Ask or give an order</Hud>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
                    I search your leads, start new searches, research businesses, verify emails and move around the app for you.
                  </p>
                  <div className="mt-4 space-y-1.5">
                    {SUGGESTIONS.map((s, i) => (
                      <motion.button
                        key={s}
                        initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.06, ease: EASE }}
                        onClick={() => send(s)}
                        className="block w-full cursor-pointer rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-left text-[12.5px] text-muted transition hover:border-accent/40 hover:bg-accent/[0.05] hover:text-text"
                      >
                        {s}
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              )}

              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}
                  className={m.role === "user" ? "flex justify-end" : ""}
                >
                  {m.role === "user" ? (
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-accent/25 bg-accent/[0.1] px-3.5 py-2 text-[13.5px]">{m.content}</div>
                  ) : (
                    <div className="space-y-2">
                      {(m.steps?.length ?? 0) > 0 && <Steps steps={m.steps!} />}
                      <div className={`text-[13.5px] leading-relaxed ${m.error ? "text-bad" : "text-text/90"}`}><Rich text={m.content} /></div>
                      {m.leads && m.leads.length > 0 && (
                        <div className="space-y-1.5">
                          {m.leads.map((l) => <LeadCard key={l.id} l={l} onOpen={() => onOpenLead(l.id)} />)}
                        </div>
                      )}
                      {m.done && m.done.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {m.done.map((d, j) => (
                            <span key={j} className="flex items-center gap-1 rounded-full border border-good/25 bg-good/[0.06] px-2 py-[3px] text-[10.5px] text-good">
                              <Check className="h-3 w-3" /> {d}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              ))}

              {busy && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  <Steps steps={live} live />
                  <div className="flex items-center gap-2 text-[12px] text-faint">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-text" /> {live.length ? "Working…" : "Thinking…"}
                  </div>
                </motion.div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="border-t border-line p-3"
            >
              <div className="flex items-end gap-2 rounded-2xl border border-line bg-black/30 px-3 py-2 transition focus-within:border-accent/50 focus-within:shadow-[0_0_28px_-12px_var(--accent)]">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  rows={1}
                  placeholder="Ask Radar or tell it what to do…"
                  className="scroll-thin max-h-28 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13.5px] outline-none placeholder:text-faint"
                />
                <motion.button
                  type="submit" whileTap={{ scale: 0.9 }} disabled={!input.trim() || busy}
                  className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-accent text-accent-ink shadow-[0_0_20px_-4px_var(--accent)] transition disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="Send"
                >
                  <ArrowUp className="h-4 w-4" />
                </motion.button>
              </div>
              <div className="mt-1.5 flex justify-between px-1 text-[10px] text-faint">
                <span>Enter to send · Shift+Enter for a new line</span>
                <Kbd>Ctrl J</Kbd>
              </div>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}

function Steps({ steps, live = false }: { steps: ChatJob["steps"]; live?: boolean }) {
  const last = steps[steps.length - 1];
  const shown = steps.filter((s) => s.kind === "result" || (live && s === last && s.kind === "tool"));
  if (!shown.length) return null;
  return (
    <ul className="space-y-1 rounded-xl border border-line bg-black/25 px-3 py-2 font-mono text-[10.5px]">
      {shown.map((s, i) => (
        <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className={s.kind === "result" ? "text-muted" : "text-accent-text"}>
          <span className="text-faint">›</span> {s.text}
        </motion.li>
      ))}
    </ul>
  );
}

function LeadCard({ l, onOpen }: { l: LeadBrief; onOpen: () => void }) {
  const color = SCORE_COLOR[scoreTone(l.score)];
  return (
    <button onClick={onOpen} className="group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-left transition hover:border-accent/35 hover:bg-accent/[0.05]">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border font-mono text-[11px] font-semibold" style={{ borderColor: `${color}55`, color }}>{l.score}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium group-hover:text-white">{l.name}</span>
        <span className="block truncate text-[10.5px] text-faint">
          {[l.city, l.email ? `${l.email} · ${EMAIL_LABEL[l.email_status]}` : l.phone].filter(Boolean).join(" · ")}
        </span>
      </span>
    </button>
  );
}
