import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AgentPlan, ApiKey, EmailStatus, EngineSearch, Lead, LeadsFile, OutreachStatus, ResearchJob, SourceHealth } from "./types";

/* ------------------------------------------------------------------ labels */

export type Tone = "good" | "warn" | "bad" | "info" | "accent" | "neutral";

export const COUNTRIES: Record<string, string> = {
  FR: "France", BE: "Belgium", CH: "Switzerland", LU: "Luxembourg", DE: "Germany", ES: "Spain", IT: "Italy",
  PT: "Portugal", NL: "Netherlands", GB: "United Kingdom", IE: "Ireland", US: "United States", CA: "Canada",
  AU: "Australia", AE: "UAE", SA: "Saudi Arabia", QA: "Qatar", MA: "Morocco", TN: "Tunisia", DZ: "Algeria",
};

export const EMAIL_LABEL: Record<EmailStatus, string> = {
  valid: "Verified", risky: "Unconfirmable", invalid: "Bounces", unknown: "Unchecked", none: "No email",
};

export const EMAIL_TONE: Record<EmailStatus, Tone> = {
  valid: "good", risky: "warn", invalid: "bad", unknown: "neutral", none: "neutral",
};

export const STATUS_LABEL: Record<OutreachStatus, string> = {
  new: "New", contacted: "Contacted", replied: "Replied", not_interested: "Not interested", won: "Client",
};

export const STATUS_TONE: Record<OutreachStatus, Tone> = {
  new: "neutral", contacted: "info", replied: "accent", not_interested: "bad", won: "good",
};

/** Every source the engine pulls from. Names must match the engine's (engine/leadradar/health.py). */
export const SOURCE_GROUPS: { group: string; items: { name: string; what: string }[] }[] = [
  {
    group: "Maps & directories",
    items: [
      { name: "Google Maps", what: "Places, rating, reviews, phone, website" },
      { name: "OpenStreetMap", what: "Businesses by category in the area" },
      { name: "Directories", what: "PagesJaunes (FR), Yellow Pages (US/CA)" },
      { name: "Company registry", what: "Legal name, directors, creation date (FR)" },
      { name: "Doctolib", what: "Already booking online? (FR/DE/IT)" },
    ],
  },
  {
    group: "Web",
    items: [
      { name: "Web search", what: "Finds missing websites (Brave)" },
      { name: "Website crawl", what: "Emails, phones, WhatsApp, social links" },
      { name: "Website audit", what: "Mobile, HTTPS, speed, booking, chat" },
      { name: "Domain history", what: "Domain age, first archived" },
    ],
  },
  {
    group: "Social & people",
    items: [
      { name: "LinkedIn", what: "Company page and decision makers" },
      { name: "Apollo", what: "Decision makers (your API key)" },
      { name: "Facebook", what: "Page link" },
      { name: "Instagram", what: "Profile link" },
      { name: "TikTok", what: "Profile link" },
      { name: "Reddit", what: "People asking for this service" },
    ],
  },
  {
    group: "Signals, email & AI",
    items: [
      { name: "Meta Ad Library", what: "Running Facebook/Instagram ads now" },
      { name: "Trustpilot", what: "Rating and complaints you can fix" },
      { name: "Hunter", what: "Emails for the domain (your key)" },
      { name: "Email check", what: "Mail server confirms the mailbox" },
      { name: "AI agent", what: "Researches top leads: owner, email, angle" },
    ],
  },
];

export const ALL_SOURCES = SOURCE_GROUPS.flatMap((g) => g.items.map((i) => i.name));

/* ------------------------------------------------------------------ engine API */

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  } catch {
    throw new Error("Engine offline");
  }
  const type = r.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new Error("Engine offline");
  const body = await r.json();
  if (!r.ok) throw new Error(body?.detail ? String(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail)) : `HTTP ${r.status}`);
  return body as T;
}

export const engine = {
  health: () => api<{ ok: boolean; running: string[]; testing_sources: boolean }>("/api/health"),
  leads: () => api<LeadsFile>("/api/leads"),
  searches: () => api<EngineSearch[]>("/api/searches"),
  createSearch: (body: { niche: string; location: string; country: string; limit: number; sources: string[] }) =>
    api<EngineSearch>("/api/searches", { method: "POST", body: JSON.stringify({ ...body, run: true }) }),
  runSearch: (id: string) => api<{ started: boolean }>(`/api/searches/${id}/run`, { method: "POST" }),
  deleteSearch: (id: string) => api<{ deleted: boolean }>(`/api/searches/${id}`, { method: "DELETE" }),
  sources: () => api<{ health: Record<string, SourceHealth>; testing: boolean }>("/api/sources"),
  testSources: (only?: string[]) => api<{ started: boolean }>("/api/sources/test", { method: "POST", body: JSON.stringify({ only: only ?? null }) }),
  keys: () => api<{ keys: ApiKey[]; search_engine: string; agent: boolean }>("/api/keys"),
  saveKey: (name: string, value: string) => api<{ saved: boolean; testing: string[] }>("/api/keys", { method: "PUT", body: JSON.stringify({ name, value }) }),
  plan: (request: string) => api<AgentPlan>("/api/agent/plan", { method: "POST", body: JSON.stringify({ request }) }),
  research: (id: string) => api<{ started: boolean }>(`/api/leads/${id}/research`, { method: "POST" }),
  researchStatus: (id: string) => api<ResearchJob>(`/api/leads/${id}/research`),
};

/** Engine status, polled. `running` lists search ids in progress. */
export function useEngineStatus() {
  const [status, setStatus] = useState<{ online: boolean | null; running: string[]; testing: boolean }>({ online: null, running: [], testing: false });
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const h = await engine.health();
        if (alive) setStatus({ online: true, running: h.running, testing: h.testing_sources });
      } catch {
        if (alive) setStatus((s) => ({ ...s, online: false, running: [] }));
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return status;
}

/** Leads found by the engine. Refreshes while searches run and once when they finish. */
export function useLeadsFile(runningCount: number, online: boolean | null) {
  const [file, setFile] = useState<LeadsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setFile(await engine.leads());
      setError(null);
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }, []);
  const prevRunning = useRef(runningCount);
  useEffect(() => {
    if (online) load();
  }, [online, load]);
  useEffect(() => {
    if (prevRunning.current > 0 && runningCount === 0) load();
    prevRunning.current = runningCount;
    if (!runningCount) return;
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [runningCount, load]);
  return { file, error, reload: load };
}

/* ------------------------------------------------------------------ per-browser store (status + notes) */

interface StoreShape {
  overrides: Record<string, { status?: OutreachStatus; note?: string; updated: string }>;
}

const KEY = "leadradar:v2";
const EMPTY: StoreShape = { overrides: {} };

function read(): StoreShape {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

let state: StoreShape = read();
const listeners = new Set<() => void>();

function commit(next: StoreShape) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: keep in memory */
  }
  listeners.forEach((l) => l());
}

export const store = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  get: () => state,
  setStatus(ids: string[], status: OutreachStatus) {
    const overrides = { ...state.overrides };
    const now = new Date().toISOString();
    ids.forEach((id) => (overrides[id] = { ...overrides[id], status, updated: now }));
    commit({ ...state, overrides });
  },
  setNote(id: string, note: string) {
    commit({ ...state, overrides: { ...state.overrides, [id]: { ...state.overrides[id], note, updated: new Date().toISOString() } } });
  },
};

export function useStore() {
  return useSyncExternalStore(store.subscribe, store.get);
}

export function useLeads(file: LeadsFile | null) {
  const { overrides } = useStore();
  return useMemo(() => {
    if (!file) return [] as Lead[];
    return file.leads.map((l) => {
      const o = overrides[l.id];
      if (!o) return l;
      return { ...l, outreach: { ...l.outreach, status: o.status ?? l.outreach.status, note: o.note ?? l.outreach.note } };
    });
  }, [file, overrides]);
}

/* ------------------------------------------------------------------ helpers */

export function websiteGaps(l: Lead): string[] {
  const a = l.audit;
  if (a.has_site === false) return ["No website"];
  const out: string[] = [];
  if (a.reachable === false) out.push("Site down");
  if (a.booking === false && !a.booking_via) out.push("No booking");
  if (a.mobile === false) out.push("Not mobile");
  if (a.https === false) out.push("No HTTPS");
  if (a.form === false) out.push("No form");
  if (a.chat === false) out.push("No chat");
  if ((a.load_ms ?? 0) > 4000) out.push("Slow");
  return out;
}

export function scoreTone(score: number): Tone {
  return score >= 60 ? "accent" : score >= 40 ? "good" : score >= 20 ? "warn" : "neutral";
}

export function downloadCsv(leads: Lead[], filename: string) {
  const cols: [string, (l: Lead) => string | number][] = [
    ["name", (l) => l.name], ["niche", (l) => l.niche], ["category", (l) => l.category], ["country", (l) => l.country],
    ["city", (l) => l.city], ["address", (l) => l.address], ["email", (l) => l.email], ["email_status", (l) => l.email_status],
    ["other_emails", (l) => l.other_emails.join(" | ")], ["phones", (l) => l.phones.join(" | ")], ["whatsapp", (l) => l.whatsapp],
    ["website", (l) => l.website], ["website_gaps", (l) => websiteGaps(l).join(" | ")],
    ["rating", (l) => l.maps.rating ?? ""], ["reviews", (l) => l.maps.reviews ?? ""],
    ["people", (l) => (l.people || []).map((p) => `${p.name} (${p.title})`).join(" | ")],
    ["facebook", (l) => l.socials.facebook || ""], ["instagram", (l) => l.socials.instagram || ""], ["linkedin", (l) => l.socials.linkedin || ""],
    ["score", (l) => l.score], ["reasons", (l) => l.reasons.map((r) => r[1]).join(" | ")],
    ["status", (l) => l.outreach.status], ["note", (l) => l.outreach.note], ["found_at", (l) => l.found_at || ""],
    ["sources", (l) => l.sources.join(" | ")],
  ];
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [cols.map((c) => c[0]).join(","), ...leads.map((l) => cols.map((c) => esc(c[1](l))).join(","))].join("\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const fmt = (n: number) => n.toLocaleString("en-US");

export function formatDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return isNaN(+d) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return formatDate(iso);
}
