import { LayoutDashboard, Radar, Search, Users } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { fmt, formatDate } from "../lib/data";
import { EASE, Hud, Kbd } from "./ui";

export type Page = "overview" | "leads" | "searches";

const NAV: { id: Page; label: string; icon: typeof Users }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "leads", label: "Leads", icon: Users },
  { id: "searches", label: "Searches", icon: Radar },
];

export function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-9 w-9 overflow-hidden rounded-xl border border-accent/30 bg-accent/[0.08] shadow-[0_0_24px_-8px_var(--accent)]">
        <svg viewBox="0 0 36 36" className="absolute inset-0">
          <circle cx="18" cy="18" r="12" fill="none" stroke="var(--accent)" strokeOpacity=".3" />
          <circle cx="18" cy="18" r="6.5" fill="none" stroke="var(--accent)" strokeOpacity=".3" />
          <g className="radar-sweep">
            <path d="M18 18 L18 6 A12 12 0 0 1 28.4 12 Z" fill="var(--accent)" fillOpacity=".35" />
            <line x1="18" y1="18" x2="18" y2="6" stroke="var(--accent)" strokeWidth="1.4" />
          </g>
          <circle cx="18" cy="18" r="2" fill="var(--accent)" />
          <circle cx="24" cy="13" r="1.3" fill="#3ee6ff" />
        </svg>
      </div>
      <div className="leading-none">
        <div className="text-[15px] font-semibold tracking-tight">Lead Radar</div>
        <div className="hud mt-1.5 !text-[8.5px]">prospect engine</div>
      </div>
    </div>
  );
}

const DOT = { warn: "bg-warn", accent: "bg-accent", good: "bg-good" } as const;
const TEXT = { warn: "text-warn", accent: "text-accent-text", good: "text-good" } as const;

function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="aurora a1" />
      <div className="aurora a2" />
      <div className="aurora a3" />
      <div className="grid-floor" />
      <div className="noise" />
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-[11px] tabular text-muted">
      <span className="text-faint">ALG</span> {now.toLocaleTimeString("en-GB", { timeZone: "Africa/Algiers", hour12: false })}
    </span>
  );
}

export function Shell({
  page, onNavigate, leadCount, running, online, generatedAt, onSearch, children,
}: {
  page: Page; onNavigate: (p: Page) => void; leadCount: number; running: number; online: boolean; generatedAt: string;
  onSearch: () => void; children: ReactNode;
}) {
  const badge = (id: Page) => (id === "leads" ? fmt(leadCount) : id === "searches" && running ? `${running} live` : "");
  const tone = !online ? "warn" : running ? "accent" : "good";

  return (
    <div className="relative flex h-full">
      <Backdrop />

      <motion.aside
        initial={{ opacity: 0, x: -24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, ease: EASE }}
        className="glass relative z-20 my-3 ml-3 hidden w-[236px] shrink-0 flex-col rounded-[24px] p-3 md:flex"
      >
        <div className="px-2 pb-6 pt-2">
          <Logo />
        </div>

        <button
          onClick={onSearch}
          className="mb-4 flex h-10 cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-white/[0.03] px-3 text-left text-xs text-faint transition hover:border-line-strong hover:text-muted"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1">Search leads…</span>
          <Kbd>Ctrl K</Kbd>
        </button>

        <Hud className="px-2.5 pb-2">Navigate</Hud>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ id, label, icon: Icon }) => {
            const active = page === id;
            return (
              <button
                key={id}
                onClick={() => onNavigate(id)}
                className={`relative flex h-10 cursor-pointer items-center justify-between rounded-xl px-3 text-[13px] transition-colors ${active ? "text-text" : "text-muted hover:text-text"}`}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-xl border border-accent/25 bg-gradient-to-r from-accent/[0.13] via-accent/[0.04] to-transparent"
                    transition={{ type: "spring", stiffness: 480, damping: 38 }}
                  >
                    <span className="absolute bottom-2.5 left-0 top-2.5 w-[2px] rounded-full bg-accent shadow-[0_0_12px_var(--accent)]" />
                  </motion.span>
                )}
                <span className="relative flex items-center gap-3">
                  <Icon className={`h-4 w-4 transition-colors ${active ? "text-accent-text" : ""}`} strokeWidth={1.75} />
                  {label}
                </span>
                {badge(id) && <span className="relative font-mono text-[10px] text-faint tabular">{badge(id)}</span>}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3">
          <div className={`rounded-2xl border p-3 ${tone === "warn" ? "border-warn/20 bg-warn/[0.05]" : tone === "accent" ? "border-accent/25 bg-accent/[0.06]" : "border-good/20 bg-good/[0.05]"}`}>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className={`ping-soft absolute inline-flex h-full w-full rounded-full ${DOT[tone]}`} />
                <span className={`relative inline-flex h-2 w-2 rounded-full ${DOT[tone]}`} />
              </span>
              <span className={`text-[12px] font-medium ${TEXT[tone]}`}>
                {!online ? "Engine offline" : running ? `Searching · ${running} running` : "Engine online"}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
              {!online ? "Start engine/run.py to search." : running ? "New leads appear as they're confirmed." : "Ready. Start a search from Searches."}
            </p>
          </div>
          <div className="px-2 text-[10.5px] text-faint">Updated {formatDate(generatedAt)}</div>
        </div>
      </motion.aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 md:px-8">
          <div className="md:hidden">
            <Logo />
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <Hud>Lead Radar</Hud>
            <span className="text-faint">/</span>
            <motion.span key={page} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="hud !text-accent-text">
              {page}
            </motion.span>
          </div>
          <div className="flex items-center gap-4">
            <Clock />
            <button onClick={onSearch} className="grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-line bg-white/[0.03] text-muted md:hidden" aria-label="Search">
              <Search className="h-4 w-4" />
            </button>
          </div>
        </header>
        <nav className="flex gap-1 px-3 pb-2 md:hidden">
          {NAV.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={`h-9 flex-1 cursor-pointer rounded-full text-xs transition ${page === id ? "border border-accent/30 bg-accent/10 text-accent-text" : "border border-line text-muted"}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <main id="main-scroll" className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
