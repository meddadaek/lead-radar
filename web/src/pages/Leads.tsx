import { ChevronLeft, ChevronRight, Copy, Download, Globe as GlobeIcon, Mail, MessageCircle, Phone, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Button, CountUp, CountryCode, EASE, Hud, Pill, ScoreMeter, Select, useSpotlight } from "../components/ui";
import {
  COUNTRIES, EMAIL_LABEL, EMAIL_TONE, STATUS_LABEL, STATUS_TONE, downloadCsv, fmt, formatDate, store, websiteGaps,
} from "../lib/data";
import type { Lead, OutreachStatus } from "../lib/types";
import type { Page } from "../components/Shell";

export interface Filters {
  q: string;
  country: string;
  niche: string;
  email: string;
  site: string;
  status: string;
  minScore: number;
  sort: "score" | "name" | "sent";
}

export const NO_FILTERS: Filters = { q: "", country: "", niche: "", email: "", site: "", status: "", minScore: 0, sort: "score" };

const PAGE = 50;

function applyFilters(leads: Lead[], f: Filters) {
  const q = f.q.trim().toLowerCase();
  const out = leads.filter((l) => {
    if (f.country && l.country !== f.country) return false;
    if (f.niche && l.niche !== f.niche) return false;
    if (f.email) {
      if (f.email === "none" ? !(l.email_status === "none" || l.email_status === "unknown") : l.email_status !== f.email) return false;
    }
    if (f.site === "none" && l.audit.has_site !== false) return false;
    if (f.site === "gaps" && (l.audit.has_site === false || websiteGaps(l).length === 0)) return false;
    if (f.site === "has" && !l.website) return false;
    if (f.status === "touched" ? l.outreach.status === "new" : f.status && l.outreach.status !== f.status) return false;
    if (l.score < f.minScore) return false;
    if (q && !`${l.name} ${l.email} ${l.city} ${l.website} ${l.category}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (f.sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
  else if (f.sort === "sent") out.sort((a, b) => b.outreach.sent.localeCompare(a.outreach.sent));
  else out.sort((a, b) => b.score - a.score);
  return out;
}

function count(leads: Lead[], key: (l: Lead) => string) {
  const m = new Map<string, number>();
  leads.forEach((l) => m.set(key(l), (m.get(key(l)) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const COLS = "grid-cols-[34px_minmax(240px,2.4fr)_54px_minmax(120px,1fr)_108px_minmax(160px,1.4fr)_112px_minmax(124px,1fr)]";

const TONE_VAR: Record<string, string> = { good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)", neutral: "var(--faint)", info: "var(--cyan)", accent: "var(--accent)" };

export function Leads({
  leads, filters, setFilters, onOpen, onNavigate,
}: { leads: Lead[]; filters: Filters; setFilters: (f: Filters) => void; onOpen: (id: string) => void; onNavigate: (p: Page) => void }) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState("");
  const table = useSpotlight<HTMLDivElement>();

  const rows = useMemo(() => applyFilters(leads, filters), [leads, filters]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const visible = rows.slice(page * PAGE, page * PAGE + PAGE);

  useEffect(() => {
    setPage(0);
    document.getElementById("main-scroll")?.scrollTo({ top: 0 });
  }, [filters]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), 2000);
    return () => clearTimeout(t);
  }, [flash]);

  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const active = JSON.stringify({ ...filters, sort: "score" }) !== JSON.stringify(NO_FILTERS);
  const countries = useMemo(() => count(leads, (l) => l.country), [leads]);
  const niches = useMemo(() => count(leads, (l) => l.niche), [leads]);

  const pageIds = visible.map((l) => l.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const selectedLeads = () => leads.filter((l) => selected.has(l.id));
  const goPage = (p: number) => {
    setPage(p);
    document.getElementById("main-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const summary = useMemo(() => ({
    hot: rows.filter((l) => l.score >= 60).length,
    valid: rows.filter((l) => l.email_status === "valid").length,
    fresh: rows.filter((l) => l.outreach.status === "new").length,
  }), [rows]);

  return (
    <div className="mx-auto max-w-[1480px] px-4 pb-28 pt-4 md:px-8">
      <motion.div initial={{ opacity: 0, y: 18, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.8, ease: EASE }} className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Hud accent>Lead index</Hud>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.03em] md:text-5xl">
            <span className="gradient-text"><CountUp key={rows.length} value={rows.length} duration={0.8} /></span>
            <span className="text-white/35"> leads</span>
          </h1>
          <p className="mt-2 text-sm text-muted">
            of {fmt(leads.length)} match ·{" "}
            <span className="text-accent-text">{fmt(summary.hot)} hot</span> ·{" "}
            <span className="text-good">{fmt(summary.valid)} verified email</span> ·{" "}
            {fmt(summary.fresh)} never contacted
          </p>
        </div>
        <Button onClick={() => downloadCsv(rows, `leads-${new Date().toISOString().slice(0, 10)}.csv`)} disabled={!rows.length}>
          <Download className="h-3.5 w-3.5" /> Export {fmt(rows.length)} to CSV
        </Button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.7, ease: EASE }} className="mt-6 flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-[240px] flex-1 items-center gap-2.5 rounded-full border border-line bg-white/[0.03] px-3.5 transition focus-within:border-accent/50 focus-within:shadow-[0_0_24px_-10px_var(--accent)] md:max-w-xs">
          <Search className="h-3.5 w-3.5 text-faint" />
          <input
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Name, email, city, website…"
            className="h-full flex-1 bg-transparent text-xs outline-none placeholder:text-faint"
          />
          {filters.q && (
            <button onClick={() => set({ q: "" })} className="cursor-pointer text-faint hover:text-text" aria-label="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
        <Select label="Country" value={filters.country} onChange={(v) => set({ country: v })}
          options={[{ value: "", label: "All" }, ...countries.map(([c, n]) => ({ value: c, label: `${COUNTRIES[c] ?? c} (${fmt(n)})` }))]} />
        <Select label="Niche" value={filters.niche} onChange={(v) => set({ niche: v })}
          options={[{ value: "", label: "All" }, ...niches.map(([c, n]) => ({ value: c, label: `${c} (${fmt(n)})` }))]} />
        <Select label="Email" value={filters.email} onChange={(v) => set({ email: v })}
          options={[{ value: "", label: "Any" }, { value: "valid", label: "Verified" }, { value: "risky", label: "Unverifiable" }, { value: "invalid", label: "Bounces" }, { value: "none", label: "No email" }]} />
        <Select label="Site" value={filters.site} onChange={(v) => set({ site: v })}
          options={[{ value: "", label: "Any" }, { value: "none", label: "No website" }, { value: "gaps", label: "Site with problems" }, { value: "has", label: "Has a website" }]} />
        <Select label="Status" value={filters.status} onChange={(v) => set({ status: v })}
          options={[{ value: "", label: "Any" }, { value: "new", label: "New" }, { value: "touched", label: "Contacted (any)" }, { value: "contacted", label: "Contacted" }, { value: "replied", label: "Replied" }, { value: "won", label: "Client" }, { value: "not_interested", label: "Not interested" }]} />
        <Select label="Score" value={filters.minScore ? String(filters.minScore) : ""} onChange={(v) => set({ minScore: Number(v) || 0 })}
          options={[{ value: "", label: "Any" }, ...[10, 20, 30, 40, 50, 60, 70].map((s) => ({ value: String(s), label: `${s}+` }))]} />
        <Select label="Sort" value={filters.sort === "score" ? "" : filters.sort} onChange={(v) => set({ sort: (v || "score") as Filters["sort"] })}
          options={[{ value: "", label: "Best score" }, { value: "name", label: "Name A–Z" }, { value: "sent", label: "Recently contacted" }]} />
        <AnimatePresence>
          {active && (
            <motion.button
              initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
              onClick={() => setFilters(NO_FILTERS)} className="flex h-9 cursor-pointer items-center gap-1.5 px-2 text-xs text-muted hover:text-text"
            >
              <X className="h-3.5 w-3.5" /> Reset
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>

      <motion.div
        ref={table.ref}
        onMouseMove={table.onMouseMove}
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.8, ease: EASE }}
        className="glass spot scroll-thin mt-5 overflow-x-auto rounded-[22px]"
      >
        <div className="min-w-[1120px]">
          <div className={`grid ${COLS} items-center gap-3 border-b border-line px-5 py-3`}>
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={() => {
                const next = new Set(selected);
                pageIds.forEach((id) => (allPageSelected ? next.delete(id) : next.add(id)));
                setSelected(next);
              }}
              className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
              aria-label="Select page"
            />
            {["Business", "Market", "Niche", "Reach", "Gaps found", "Fit score", "Status"].map((h) => <Hud key={h}>{h}</Hud>)}
          </div>

          {visible.length === 0 ? (
            <div className="grid place-items-center gap-4 px-6 py-20 text-center">
              <div className="relative h-16 w-16 rounded-full border border-line">
                <div className="radar-sweep absolute inset-1 rounded-full" style={{ background: "conic-gradient(from 0deg, rgba(200,245,66,.35), transparent 70deg)" }} />
              </div>
              {leads.length === 0 ? (
                <>
                  <p className="text-sm text-muted">No leads yet. Run a search and confirmed new businesses appear here.</p>
                  <Button variant="primary" onClick={() => onNavigate("searches")}>Start a search</Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted">Nothing on radar for these filters.</p>
                  <Button onClick={() => setFilters(NO_FILTERS)}>Reset filters</Button>
                </>
              )}
            </div>
          ) : (
            <div key={`${page}-${JSON.stringify(filters)}`}>
              {visible.map((l, i) => {
                const gaps = websiteGaps(l);
                const isSel = selected.has(l.id);
                const hot = l.score >= 60;
                const emailTone = EMAIL_TONE[l.email_status];
                return (
                  <motion.div
                    key={l.id}
                    initial={{ opacity: 0, x: -14, filter: "blur(6px)" }}
                    animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                    transition={{ delay: Math.min(i, 18) * 0.025, duration: 0.45, ease: EASE }}
                    onClick={() => onOpen(l.id)}
                    className={`group relative grid ${COLS} cursor-pointer items-center gap-3 border-b border-white/[0.04] px-5 py-3 transition-colors last:border-0 ${isSel ? "bg-accent/[0.07]" : "hover:bg-white/[0.035]"}`}
                  >
                    <span className={`absolute bottom-2 left-0 top-2 w-[2px] rounded-full transition-all duration-300 ${hot ? "bg-accent shadow-[0_0_12px_var(--accent)]" : "bg-transparent group-hover:bg-cyan/70"}`} />
                    <input
                      type="checkbox"
                      checked={isSel}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggle(l.id)}
                      className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
                      aria-label={`Select ${l.name}`}
                    />
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-[13px] font-semibold transition group-hover:scale-105"
                        style={{
                          borderColor: hot ? "rgba(200,245,66,.35)" : "var(--line)",
                          background: hot ? "rgba(200,245,66,.08)" : "rgba(255,255,255,.03)",
                          color: hot ? "var(--accent-text)" : "var(--muted)",
                        }}
                      >
                        {l.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium transition group-hover:text-white">{l.name}</div>
                        <div className="truncate font-mono text-[10.5px] text-faint">{l.email || l.website.replace(/^https?:\/\/(www\.)?/, "") || l.phones[0] || "—"}</div>
                      </div>
                    </div>
                    <div><CountryCode code={l.country} /></div>
                    <div className="min-w-0">
                      <div className="truncate text-[12px]">{l.niche}</div>
                      <div className="truncate text-[11px] text-faint">{l.city || l.region || "—"}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span title={l.email ? `Email: ${EMAIL_LABEL[l.email_status]}` : "No email"}>
                        <Mail className="h-[15px] w-[15px]" style={{ color: l.email ? TONE_VAR[emailTone] : "rgba(255,255,255,.12)", filter: l.email_status === "valid" ? "drop-shadow(0 0 5px var(--good))" : undefined }} />
                      </span>
                      <span title={l.phones.length ? "Phone" : "No phone"}><Phone className="h-[15px] w-[15px]" style={{ color: l.phones.length ? "var(--text)" : "rgba(255,255,255,.12)" }} /></span>
                      <span title={l.whatsapp ? "WhatsApp" : "No WhatsApp"}><MessageCircle className="h-[15px] w-[15px]" style={{ color: l.whatsapp ? "var(--good)" : "rgba(255,255,255,.12)" }} /></span>
                      <span title={l.website ? "Website" : "No website"}><GlobeIcon className="h-[15px] w-[15px]" style={{ color: l.website ? "var(--cyan)" : "rgba(255,255,255,.12)" }} /></span>
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {gaps.length === 0 ? (
                        <span className="font-mono text-[10.5px] text-faint">{l.audit.reachable === undefined && l.website ? "not audited" : "—"}</span>
                      ) : (
                        <>
                          {gaps.slice(0, 2).map((g) => <Pill key={g} tone={g === "No website" || g === "Site down" ? "accent" : "warn"}>{g}</Pill>)}
                          {gaps.length > 2 && <Pill>+{gaps.length - 2}</Pill>}
                        </>
                      )}
                    </div>
                    <ScoreMeter score={l.score} />
                    <div className="min-w-0">
                      <Pill tone={STATUS_TONE[l.outreach.status]}>{STATUS_LABEL[l.outreach.status]}</Pill>
                      {l.outreach.sent && <div className="mt-1 truncate font-mono text-[10px] text-faint">{formatDate(l.outreach.sent)}</div>}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>

      {rows.length > PAGE && (
        <div className="mt-4 flex items-center justify-between text-xs text-muted">
          <span className="font-mono tabular">
            {fmt(page * PAGE + 1)}–{fmt(Math.min(rows.length, (page + 1) * PAGE))} / {fmt(rows.length)}
          </span>
          <div className="flex items-center gap-3">
            <Button onClick={() => goPage(page - 1)} disabled={page === 0}><ChevronLeft className="h-3.5 w-3.5" /> Prev</Button>
            <div className="hidden items-center gap-1 sm:flex">
              {Array.from({ length: Math.min(pages, 9) }, (_, k) => {
                const p = pages <= 9 ? k : Math.min(pages - 9, Math.max(0, page - 4)) + k;
                return (
                  <button key={p} onClick={() => goPage(p)} className={`relative h-7 w-7 cursor-pointer rounded-full font-mono text-[11px] transition ${p === page ? "text-accent-ink" : "text-muted hover:text-text"}`}>
                    {p === page && <motion.span layoutId="page-dot" className="absolute inset-0 rounded-full bg-accent shadow-[0_0_16px_-2px_var(--accent)]" />}
                    <span className="relative">{p + 1}</span>
                  </button>
                );
              })}
            </div>
            <Button onClick={() => goPage(page + 1)} disabled={page >= pages - 1}>Next <ChevronRight className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 90, opacity: 0, filter: "blur(10px)" }}
            animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
            exit={{ y: 90, opacity: 0, filter: "blur(10px)" }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="fixed inset-x-0 bottom-6 z-[900] flex justify-center px-4"
          >
            <div className="glass brackets flex flex-wrap items-center gap-2 rounded-full py-2 pl-5 pr-2">
              <span className="br tl" /><span className="br tr" /><span className="br bl" /><span className="br brr" />
              <span className="font-mono text-xs tabular text-accent-text">{fmt(selected.size)} selected</span>
              {selected.size < rows.length && (
                <button onClick={() => setSelected(new Set(rows.map((l) => l.id)))} className="cursor-pointer text-xs text-muted underline-offset-2 hover:text-text hover:underline">
                  all {fmt(rows.length)}
                </button>
              )}
              <span className="mx-1 h-5 w-px bg-line" />
              <Select
                label="Mark"
                value=""
                onChange={(v) => {
                  if (!v) return;
                  store.setStatus([...selected], v as OutreachStatus);
                  setFlash(`${fmt(selected.size)} marked ${STATUS_LABEL[v as OutreachStatus]}`);
                }}
                options={[{ value: "", label: "status…" }, ...(["new", "contacted", "replied", "won", "not_interested"] as OutreachStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))]}
              />
              <Button onClick={() => downloadCsv(selectedLeads(), `leads-selected-${selected.size}.csv`)}>
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button
                onClick={async () => {
                  const emails = selectedLeads().filter((l) => l.email && l.email_status !== "invalid").map((l) => l.email);
                  try {
                    await navigator.clipboard.writeText(emails.join("\n"));
                    setFlash(`Copied ${fmt(emails.length)} emails · bouncing ones skipped`);
                  } catch {
                    setFlash("Clipboard blocked by the browser");
                  }
                }}
              >
                <Copy className="h-3.5 w-3.5" /> Copy emails
              </Button>
              <button onClick={() => setSelected(new Set())} className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-muted transition hover:bg-white/[0.06] hover:text-text" aria-label="Clear selection">
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {flash && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
            className="glass fixed bottom-24 left-1/2 z-[950] -translate-x-1/2 rounded-full px-4 py-2 text-xs text-accent-text"
          >
            {flash}
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
