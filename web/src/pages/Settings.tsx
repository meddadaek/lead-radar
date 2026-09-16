import { Check, ExternalLink, Eye, EyeOff, KeyRound, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Button, EASE, GlowCard, Hud, Pill } from "../components/ui";
import { engine, timeAgo } from "../lib/data";
import type { ApiKey, SourceHealth } from "../lib/types";

const DOT: Record<string, string> = { ok: "#3ef08a", partial: "#ffb547", blocked: "#ff5c7a", needs_key: "#9b8cff", error: "#ff5c7a", testing: "#3ee6ff" };

export function Settings() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [meta, setMeta] = useState({ search_engine: "", agent: false });
  const [health, setHealth] = useState<Record<string, SourceHealth>>({});
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const k = await engine.keys();
      setKeys(k.keys);
      setMeta({ search_engine: k.search_engine, agent: k.agent });
      const s = await engine.sources();
      setHealth(s.health);
      setTesting(s.testing);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!testing) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [testing, load]);

  return (
    <div className="mx-auto max-w-[1000px] px-4 pb-20 pt-4 md:px-8">
      <motion.div initial={{ opacity: 0, y: 18, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.8, ease: EASE }}>
        <Hud accent>Settings</Hud>
        <h1 className="mt-2 text-4xl font-semibold tracking-[-0.03em] md:text-5xl">
          <span className="gradient-text">API</span> <span className="accent-gradient-text">keys</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          All free, email signup, no card. Keys are saved only in <span className="font-mono text-text">engine/.env</span> on this computer and never pushed to GitHub. After you save one, its sources are tested live.
        </p>
      </motion.div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="glass rounded-2xl px-4 py-3">
          <Hud>Web search engine</Hud>
          <div className={`mt-1 text-[15px] font-medium ${meta.search_engine.startsWith("Tavily") ? "text-good" : "text-warn"}`}>{meta.search_engine || "…"}</div>
        </div>
        <div className="glass rounded-2xl px-4 py-3">
          <Hud>AI agent</Hud>
          <div className={`mt-1 text-[15px] font-medium ${meta.agent ? "text-good" : "text-warn"}`}>{meta.agent ? "Connected (Groq)" : "Add a Groq key to turn it on"}</div>
        </div>
      </div>
      {error && <p className="mt-4 text-sm text-bad">{error}</p>}

      <div className="mt-4 space-y-3">
        {keys.map((k, i) => (
          <KeyCard key={k.name} k={k} delay={i * 0.05} health={health} onSaved={() => { setTesting(true); load(); }} onError={setError} />
        ))}
      </div>
    </div>
  );
}

function KeyCard({ k, delay, health, onSaved, onError }: { k: ApiKey; delay: number; health: Record<string, SourceHealth>; onSaved: () => void; onError: (m: string) => void }) {
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (v: string) => {
    setBusy(true);
    try {
      await engine.saveKey(k.name, v);
      setValue("");
      onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlowCard delay={delay}>
      <div className="flex flex-wrap items-start gap-4 px-5 py-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-white/[0.03]">
          <KeyRound className={`h-4 w-4 ${k.set ? "text-good" : "text-faint"}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">{k.label}</span>
            {k.set ? <Pill tone="good"><Check className="h-3 w-3" /> Saved {k.hint}</Pill> : <Pill>Not set</Pill>}
            <span className="text-[11px] text-faint">{k.free}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {k.unlocks.map((u) => {
              const h = health[u];
              return (
                <span key={u} title={h ? `${h.detail} · ${timeAgo(h.checked_at)}` : "Not tested yet"} className="flex items-center gap-1.5 rounded-full border border-line bg-black/20 px-2 py-[3px] text-[10.5px] text-muted">
                  <span className={`h-1.5 w-1.5 rounded-full ${h?.status === "testing" ? "animate-pulse" : ""}`} style={{ background: h ? DOT[h.status] : "rgba(255,255,255,.2)" }} />
                  {u}
                </span>
              );
            })}
          </div>
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) save(value.trim());
            }}
          >
            <label className="flex h-10 min-w-[240px] flex-1 items-center rounded-xl border border-line bg-black/25 px-3 focus-within:border-accent/50">
              <input
                type={show ? "text" : "password"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={k.set ? "Paste a new key to replace it" : `Paste your ${k.label} key`}
                autoComplete="off"
                spellCheck={false}
                className="h-full flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-faint"
              />
              <button type="button" onClick={() => setShow(!show)} className="cursor-pointer text-faint hover:text-text" aria-label={show ? "Hide key" : "Show key"}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </label>
            <Button variant="primary" type="submit" disabled={!value.trim() || busy}>Save & test</Button>
            {k.set && (
              <Button variant="danger" onClick={() => save("")} disabled={busy}>
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </Button>
            )}
            <a href={k.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 px-2 text-xs text-accent-text hover:underline">
              Get a key <ExternalLink className="h-3 w-3" />
            </a>
          </form>
        </div>
      </div>
    </GlowCard>
  );
}
