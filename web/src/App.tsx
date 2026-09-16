import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Boot } from "./components/Boot";
import { CommandPalette } from "./components/CommandPalette";
import { LeadDrawer } from "./components/LeadDrawer";
import { Logo, Shell, type Page } from "./components/Shell";
import { EASE } from "./components/ui";
import { useEngineStatus, useLeads, useLeadsFile } from "./lib/data";
import { Leads, NO_FILTERS, type Filters } from "./pages/Leads";
import { Overview } from "./pages/Overview";
import { Searches } from "./pages/Searches";

const PAGES: Page[] = ["overview", "leads", "searches"];

function readHash(): Page {
  const h = window.location.hash.replace(/^#\/?/, "") as Page;
  return PAGES.includes(h) ? h : "overview";
}

export default function App() {
  const status = useEngineStatus();
  const { file, error, reload } = useLeadsFile(status.running.length, status.online);
  const leads = useLeads(file);
  const reduce = useReducedMotion();
  const [page, setPage] = useState<Page>(readHash);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [minBoot, setMinBoot] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMinBoot(true), reduce ? 0 : 2300);
    return () => clearTimeout(t);
  }, [reduce]);

  useEffect(() => {
    const onHash = () => setPage(readHash());
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const navigate = useCallback((p: Page) => {
    window.location.hash = `/${p}`;
    setPage(p);
    document.getElementById("main-scroll")?.scrollTo({ top: 0 });
  }, []);

  const filterAndGo = useCallback((f: Partial<Filters>) => {
    setFilters({ ...NO_FILTERS, ...f });
    navigate("leads");
  }, [navigate]);

  const hotLeads = useCallback(() => filterAndGo({ minScore: 60, status: "new" }), [filterAndGo]);
  const closeDrawer = useCallback(() => setOpenId(null), []);
  const closePalette = useCallback(() => setPalette(false), []);

  if (status.online === false && !file) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="glass max-w-lg rounded-3xl p-7">
          <Logo />
          <div className="mt-6 flex items-center gap-2 text-sm text-warn">
            <span className="h-2 w-2 animate-pulse rounded-full bg-warn" /> The engine isn't running
          </div>
          <p className="mt-2 text-sm text-muted">Start it and this page connects on its own within a few seconds:</p>
          <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-black/40 p-3 font-mono text-xs text-accent-text">
            lead-radar\engine\.venv\Scripts\python.exe lead-radar\engine\run.py
          </pre>
          {error && <p className="mt-3 font-mono text-[11px] text-faint">{error}</p>}
        </div>
      </div>
    );
  }

  const booted = minBoot && !!file;

  return (
    <>
      <AnimatePresence>{!booted && <Boot file={file} />}</AnimatePresence>

      {file && (
        <Shell
          page={page} onNavigate={navigate} leadCount={leads.length} running={status.running.length}
          online={status.online !== false} generatedAt={file.generated_at} onSearch={() => setPalette(true)}
        >
          {booted && (
            <AnimatePresence mode="wait">
              <motion.div
                key={page}
                // no filter here: a filter on this wrapper would stop the glass panels inside from blurring what's behind them
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.4, ease: EASE }}
              >
                {page === "overview" && <Overview file={file} leads={leads} onFilter={filterAndGo} onOpen={setOpenId} onNavigate={navigate} />}
                {page === "leads" && <Leads leads={leads} filters={filters} setFilters={setFilters} onOpen={setOpenId} onNavigate={navigate} />}
                {page === "searches" && <Searches leads={leads} running={status.running} onLeadsChanged={reload} />}
              </motion.div>
            </AnimatePresence>
          )}
        </Shell>
      )}

      <LeadDrawer lead={leads.find((l) => l.id === openId) ?? null} onClose={closeDrawer} />
      <CommandPalette open={palette} onClose={closePalette} leads={leads} onOpenLead={setOpenId} onNavigate={navigate} onHotLeads={hotLeads} />
    </>
  );
}
