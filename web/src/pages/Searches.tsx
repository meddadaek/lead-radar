import { Activity, Check, ExternalLink, Play, RotateCw, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EASE, GlowCard, Hud, Pill } from "../components/ui";
import { ALL_SOURCES, COUNTRIES, SOURCE_GROUPS, engine, fmt, timeAgo } from "../lib/data";
import type { EngineSearch, HealthStatus, Lead, SourceHealth } from "../lib/types";

const field = "h-11 w-full rounded-xl border border-line bg-black/25 px-3.5 text-[14px] outline-none transition placeholder:text-faint focus:border-accent/50 focus:shadow-[0_0_28px_-12px_var(--accent)]";

const HEALTH: Record<HealthStatus, { color: string; label: string }> = {
  ok: { color: "#3ef08a", label: "Working" },
  partial: { color: "#ffb547", label: "Partly working" },
  blocked: { color: "#ff5c7a", label: "Blocked by the site" },
  needs_key: { color: "#9b8cff", label: "Needs your API key" },
  error: { color: "#ff5c7a", label: "Failed" },
  testing: { color: "#3ee6ff", label: "Testing…" },
};

const STEP_LABEL: Record<string, string> = {
  starting: "Starting", exclusion: "Loading exclusion list", locate: "Locating area", discover: "Discovering businesses",
  enrich: "Checking contacts & enriching", done: "Finished",
};

export function Searches({ leads, running, onLeadsChanged }: { leads: Lead[]; running: string[]; onLeadsChanged: () => void }) {
  const [searches, setSearches] = useState<EngineSearch[]>([]);
  const [health, setHealth] = useState<Record<string, SourceHealth>>({});
  const [testing, setTesting] = useState(false);
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [country, setCountry] = useState("FR");
  const [limit, setLimit] = useState(20);
  const [sources, setSources] = useState<Set<string>>(new Set(ALL_SOURCES));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadSearches = useCallback(async () => {
    try {
      setSearches(await engine.searches());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  const loadHealth = useCallback(async () => {
    try {
      const h = await engine.sources();
      setHealth(h.health);
      setTesting(h.testing);
    } catch {
      /* engine offline: shown by the shell */
    }
  }, []);

  useEffect(() => {
    loadSearches();
    loadHealth();
  }, [loadSearches, loadHealth]);
  useEffect(() => {
    if (!running.length) return;
    const t = setInterval(loadSearches, 2000);
    return () => clearInterval(t);
  }, [running.length, loadSearches]);
  useEffect(() => {
    loadSearches();
    onLeadsChanged();
  }, [running.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!testing) return;
    const t = setInterval(loadHealth, 2000);
    return () => clearInterval(t);
  }, [testing, loadHealth]);

  const niches = useMemo(() => [...new Set(leads.map((l) => l.niche))].sort(), [leads]);
  const canStart = Boolean(niche.trim() && location.trim() && sources.size > 0) && !busy;
  const toggle = (names: string[], on: boolean) => {
    const next = new Set(sources);
    names.forEach((n) => (on ? next.add(n) : next.delete(n)));
    setSources(next);
  };
  const healthCounts = useMemo(() => {
    const c: Partial<Record<HealthStatus, number>> = {};
    Object.values(health).forEach((h) => (c[h.status] = (c[h.status] || 0) + 1));
    return c;
  }, [health]);

  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-20 pt-4 md:px-8">
      <motion.div initial={{ opacity: 0, y: 18, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.8, ease: EASE }}>
        <Hud accent>Search engine</Hud>
        <h1 className="mt-2 text-4xl font-semibold tracking-[-0.03em] md:text-5xl">
          <span className="gradient-text">Find</span> <span className="accent-gradient-text">new leads</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Type a niche and a place. The engine discovers the businesses, reads their websites, confirms each email with its mail server and each phone number, enriches them, and skips everyone from past campaigns.
        </p>
      </motion.div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canStart) return;
          setBusy(true);
          setError("");
          try {
            await engine.createSearch({ niche: niche.trim(), location: location.trim(), country, limit, sources: ALL_SOURCES.filter((s) => sources.has(s)) });
            await loadSearches();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <GlowCard className="mt-6" kicker="01 · Target" title="Who to find">
          <div className="grid grid-cols-1 gap-4 px-5 pb-6 pt-4 md:grid-cols-[2fr_2fr_1.3fr_1fr]">
            <label className="block">
              <Hud className="mb-2">Niche or keyword</Hud>
              <input className={field} list="niche-list" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="dentiste, hotel, avocat…" />
              <datalist id="niche-list">{niches.map((n) => <option key={n} value={n} />)}</datalist>
            </label>
            <label className="block">
              <Hud className="mb-2">City or region</Hud>
              <input className={field} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lyon" />
            </label>
            <label className="block">
              <Hud className="mb-2">Country</Hud>
              <select className={`${field} cursor-pointer`} value={country} onChange={(e) => setCountry(e.target.value)}>
                {Object.entries(COUNTRIES).map(([code, name]) => <option key={code} value={code} className="bg-panel-solid">{name}</option>)}
              </select>
            </label>
            <label className="block">
              <Hud className="mb-2">Leads to save</Hud>
              <input className={`${field} font-mono`} type="number" min={5} max={500} step={5} value={limit} onChange={(e) => setLimit(Math.max(5, Math.min(500, Number(e.target.value) || 20)))} />
            </label>
          </div>
        </GlowCard>

        <GlowCard
          className="mt-4" kicker="02 · Sources" title="Where to pull from"
          hint="Each dot is the result of a live test against a real business. Run the test any time to see what is working right now."
          right={
            <div className="flex flex-wrap items-center justify-end gap-3 text-xs">
              <span className="hidden font-mono text-muted sm:inline"><span className="text-accent-text">{sources.size}</span>/{ALL_SOURCES.length} on</span>
              <button type="button" onClick={() => setSources(new Set(ALL_SOURCES))} className="cursor-pointer text-accent-text hover:underline">All</button>
              <button type="button" onClick={() => setSources(new Set())} className="cursor-pointer text-muted hover:text-text">None</button>
              <Button
                onClick={async () => {
                  try {
                    await engine.testSources();
                    setTesting(true);
                    setTimeout(loadHealth, 400);
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
                disabled={testing}
              >
                {testing ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
                {testing ? "Testing sources…" : "Test all sources"}
              </Button>
            </div>
          }
        >
          {Object.keys(health).length > 0 && (
            <div className="flex flex-wrap gap-2 px-5 pt-4">
              {(Object.keys(HEALTH) as HealthStatus[]).filter((k) => healthCounts[k]).map((k) => (
                <span key={k} className="flex items-center gap-1.5 rounded-full border border-line bg-black/20 px-2.5 py-1 text-[11px] text-muted">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: HEALTH[k].color, boxShadow: `0 0 8px ${HEALTH[k].color}` }} />
                  {HEALTH[k].label} · {healthCounts[k]}
                </span>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 gap-5 px-5 pb-6 pt-4 md:grid-cols-2 lg:grid-cols-4">
            {SOURCE_GROUPS.map((g, gi) => {
              const names = g.items.map((i) => i.name);
              const allOn = names.every((n) => sources.has(n));
              return (
                <div key={g.group}>
                  <button type="button" onClick={() => toggle(names, !allOn)} className="hud mb-2.5 cursor-pointer hover:!text-text">{g.group}</button>
                  <div className="space-y-1.5">
                    {g.items.map((i, ii) => {
                      const on = sources.has(i.name);
                      const h = health[i.name];
                      return (
                        <motion.button
                          type="button" key={i.name} onClick={() => toggle([i.name], !on)}
                          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + gi * 0.05 + ii * 0.03, ease: EASE }}
                          whileTap={{ scale: 0.97 }}
                          title={h ? `${HEALTH[h.status].label}: ${h.detail} (${timeAgo(h.checked_at)})` : "Not tested yet"}
                          className={`relative flex w-full cursor-pointer items-start gap-3 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-all duration-300 ${on ? "border-accent/35 bg-accent/[0.07] shadow-[0_0_24px_-14px_var(--accent)]" : "border-line bg-white/[0.015] hover:border-line-strong"}`}
                        >
                          <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border transition ${on ? "border-accent bg-accent text-accent-ink" : "border-line-strong"}`}>
                            <AnimatePresence>{on && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Check className="h-3 w-3" strokeWidth={3} /></motion.span>}</AnimatePresence>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`flex items-center justify-between gap-2 text-[13px] font-medium leading-tight ${on ? "text-text" : "text-muted"}`}>
                              {i.name}
                              <span
                                className={`h-2 w-2 shrink-0 rounded-full ${h?.status === "testing" ? "animate-pulse" : ""}`}
                                style={{ background: h ? HEALTH[h.status].color : "rgba(255,255,255,.15)", boxShadow: h ? `0 0 8px ${HEALTH[h.status].color}` : undefined }}
                              />
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-snug text-faint">{h && h.status !== "ok" && h.status !== "testing" ? h.detail : i.what}</span>
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-4">
            {error && <span className="mr-auto text-xs text-bad">{error}</span>}
            {!niche.trim() || !location.trim() ? <span className="text-xs text-faint">Add a niche and a place to start</span> : null}
            <Button variant="primary" type="submit" disabled={!canStart}>
              <Play className="h-3.5 w-3.5" /> Start search
            </Button>
          </div>
        </GlowCard>
      </form>

      <div className="mt-10 flex items-center justify-between">
        <Hud accent>03 · Runs</Hud>
        <span className="font-mono text-[11px] text-faint">{searches.length} searches</span>
      </div>
      {searches.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-faint">No searches yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          <AnimatePresence initial={false}>
            {searches.map((s) => (
              <SearchCard key={s.id} s={s} onChange={loadSearches} onError={setError} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

function SearchCard({ s, onChange, onError }: { s: EngineSearch; onChange: () => void; onError: (m: string) => void }) {
  const p = s.progress || {};
  const live = s.running || s.state === "running";
  const pct = live ? p.pct ?? 0 : s.state === "done" ? 100 : p.pct ?? 0;
  const stats: [string, number | undefined, string?][] = [
    ["Found", p.found], ["Past campaigns skipped", p.known], ["Checked", p.checked], ["Saved", p.saved, "text-accent-text"],
    ["Verified emails", p.emails_valid, "text-good"], ["Valid phones", p.phones_valid, "text-cyan"], ["No confirmed contact", p.no_contact],
  ];
  const errors = Object.entries(p.source_errors || {});
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -12, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: 0.5, ease: EASE }}
      className={`glass relative overflow-hidden rounded-2xl ${live ? "border-accent/30" : ""}`}
    >
      {live && <div className="scanline pointer-events-none absolute inset-0" />}
      <div className="flex flex-wrap items-start gap-4 px-5 pt-4">
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold tracking-tight">
            {s.params.niche} <span className="font-normal text-faint">in</span> {s.params.location}, {COUNTRIES[s.params.country] ?? s.params.country}
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-faint">
            up to {s.params.limit} leads · {s.params.sources.length} sources · {s.last_run ? `ran ${timeAgo(s.last_run)}` : `created ${timeAgo(s.created)}`}
          </div>
        </div>
        {live ? (
          <Pill tone="accent"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />Running</Pill>
        ) : s.state === "done" ? (
          <Pill tone="good">Done</Pill>
        ) : s.state === "error" ? (
          <Pill tone="bad">Stopped</Pill>
        ) : (
          <Pill>Queued</Pill>
        )}
        <div className="flex items-center gap-1">
          <button
            disabled={live}
            onClick={async () => {
              try {
                await engine.runSearch(s.id);
                onChange();
              } catch (e) {
                onError((e as Error).message);
              }
            }}
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-muted transition hover:bg-white/[0.06] hover:text-accent-text disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Run again" title="Run again"
          >
            <RotateCw className="h-4 w-4" />
          </button>
          <button
            disabled={live}
            onClick={async () => {
              try {
                await engine.deleteSearch(s.id);
                onChange();
              } catch (e) {
                onError((e as Error).message);
              }
            }}
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-faint transition hover:bg-bad/10 hover:text-bad disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Delete search" title="Delete search"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="px-5 pt-4">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted">{STEP_LABEL[p.step || ""] || (s.state === "error" ? "Stopped" : "Waiting")}</span>
          <span className="font-mono tabular text-text">{pct}%</span>
        </div>
        <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div
            className={`h-full rounded-full ${s.state === "error" ? "bg-bad" : "bg-gradient-to-r from-cyan to-accent"}`}
            style={{ boxShadow: s.state === "error" ? undefined : "0 0 14px var(--accent)" }}
            animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: EASE }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px px-5 pt-4 sm:grid-cols-4 lg:grid-cols-7">
        {stats.map(([label, v, cls]) => (
          <div key={label} className="py-1">
            <div className="hud !text-[8.5px] !tracking-[0.12em]">{label}</div>
            <div className={`mt-0.5 font-mono text-lg tabular ${cls || "text-text"}`}>{fmt(v ?? 0)}</div>
          </div>
        ))}
      </div>

      {s.last_error && <p className="mx-5 mt-3 rounded-lg border border-bad/25 bg-bad/[0.06] px-3 py-2 text-xs text-bad">{s.last_error}</p>}

      {errors.length > 0 && (
        <div className="mx-5 mt-3 flex flex-wrap gap-1.5">
          {errors.map(([name, msg]) => (
            <span key={name} title={msg} className="flex items-center gap-1 rounded-full border border-warn/25 bg-warn/[0.05] px-2 py-[3px] text-[10.5px] text-warn">
              <X className="h-3 w-3" /> {name}: {msg.split(":")[0]}
            </span>
          ))}
        </div>
      )}

      <div className="scroll-thin mx-5 mb-4 mt-3 max-h-48 overflow-y-auto rounded-xl border border-line bg-black/30 px-3 py-2 font-mono text-[11px]">
        <AnimatePresence initial={false}>
          {s.events.length === 0 && <div className="py-1 text-faint">Waiting for the engine…</div>}
          {s.events.map((e) => (
            <motion.div
              key={e.ts + e.message}
              initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
              className={`flex gap-2 py-[3px] ${e.level === "lead" ? "text-accent-text" : e.level === "warn" || e.level === "error" ? "text-warn" : e.level === "skip" ? "text-faint" : e.level === "done" ? "text-good" : "text-muted"}`}
            >
              <span className="shrink-0 text-faint">{new Date(e.ts).toLocaleTimeString("en-GB", { hour12: false })}</span>
              <span className="break-words">{e.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {(p.intent?.length ?? 0) > 0 && (
        <div className="mx-5 mb-4">
          <Hud>Reddit · people asking for this</Hud>
          <ul className="mt-2 space-y-1">
            {p.intent!.map((post) => (
              <li key={post.url}>
                <a href={post.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[12px] text-muted hover:text-text">
                  <ExternalLink className="h-3 w-3 shrink-0 text-faint" /> <span className="truncate">{post.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.li>
  );
}
