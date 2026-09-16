import { ArrowRight, CornerDownLeft, Flame, LayoutDashboard, Radar, Search, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES, fmt, scoreTone } from "../lib/data";
import type { Lead } from "../lib/types";
import type { Page } from "./Shell";
import { EASE, Kbd, SCORE_COLOR } from "./ui";

type Item =
  | { kind: "lead"; lead: Lead }
  | { kind: "cmd"; id: string; label: string; icon: typeof Search; run: () => void };

export function CommandPalette({
  open, onClose, leads, onOpenLead, onNavigate, onHotLeads,
}: {
  open: boolean; onClose: () => void; leads: Lead[];
  onOpenLead: (id: string) => void; onNavigate: (p: Page) => void; onHotLeads: () => void;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const cmds: Item[] = [
      { kind: "cmd", id: "hot", label: "Show hot leads (score 60+, never contacted)", icon: Flame, run: onHotLeads },
      { kind: "cmd", id: "overview", label: "Go to Overview", icon: LayoutDashboard, run: () => onNavigate("overview") },
      { kind: "cmd", id: "leads", label: "Go to Leads", icon: Users, run: () => onNavigate("leads") },
      { kind: "cmd", id: "searches", label: "Go to Searches", icon: Radar, run: () => onNavigate("searches") },
    ];
    const matchedCmds = cmds.filter((c) => c.kind === "cmd" && (!term || c.label.toLowerCase().includes(term)));
    const matchedLeads: Item[] = term
      ? leads
          .filter((l) => `${l.name} ${l.email} ${l.city} ${l.website}`.toLowerCase().includes(term))
          .sort((a, b) => b.score - a.score)
          .slice(0, 7)
          .map((lead) => ({ kind: "lead" as const, lead }))
      : leads.filter((l) => l.outreach.status === "new").slice(0, 5).map((lead) => ({ kind: "lead" as const, lead }));
    return [...matchedLeads, ...matchedCmds];
  }, [q, leads, onHotLeads, onNavigate]);

  useEffect(() => setIdx(0), [q]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    if (item.kind === "lead") onOpenLead(item.lead.id);
    else item.run();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="palette"
          className="fixed inset-0 z-[2000] flex items-start justify-center px-4 pt-[14vh]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="glass brackets relative w-full max-w-xl overflow-hidden rounded-2xl"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              if (e.key === "Enter") { e.preventDefault(); run(items[idx]); }
              if (e.key === "Escape") onClose();
            }}
          >
            <span className="br tl" /><span className="br tr" /><span className="br bl" /><span className="br brr" />
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="h-4 w-4 text-accent-text" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Search ${fmt(leads.length)} businesses or type a command…`}
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
              />
              <Kbd>Esc</Kbd>
            </div>
            <div className="scroll-thin max-h-[52vh] overflow-y-auto p-2">
              {!q && <div className="hud px-3 pb-1 pt-2">Top untouched leads</div>}
              {items.length === 0 && <p className="px-3 py-8 text-center text-sm text-faint">No match for “{q}”.</p>}
              {items.map((item, i) => {
                const active = i === idx;
                const color = item.kind === "lead" ? SCORE_COLOR[scoreTone(item.lead.score)] : "";
                return (
                  <button
                    key={item.kind === "lead" ? item.lead.id : item.id}
                    onMouseEnter={() => setIdx(i)}
                    onClick={() => run(item)}
                    className="relative flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left"
                  >
                    {active && (
                      <motion.span layoutId="palette-active" className="absolute inset-0 rounded-xl border border-accent/30 bg-accent/[0.08]" transition={{ type: "spring", stiffness: 600, damping: 40 }} />
                    )}
                    {item.kind === "lead" ? (
                      <>
                        <span className="relative h-2 w-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
                        <span className="relative min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{item.lead.name}</span>
                          <span className="block truncate text-[11px] text-faint">
                            {[item.lead.niche, item.lead.city, COUNTRIES[item.lead.country]].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className="relative font-mono text-xs tabular" style={{ color }}>{item.lead.score}</span>
                      </>
                    ) : (
                      <>
                        <item.icon className="relative h-4 w-4 text-muted" />
                        <span className="relative flex-1 text-[13px]">{item.label}</span>
                        <ArrowRight className="relative h-3.5 w-3.5 text-faint" />
                      </>
                    )}
                    {active && <CornerDownLeft className="relative h-3.5 w-3.5 text-accent-text" />}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-[11px] text-faint">
              <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
              <span className="flex items-center gap-1.5"><Kbd>Enter</Kbd> open</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
