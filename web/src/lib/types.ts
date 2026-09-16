export type EmailStatus = "valid" | "risky" | "invalid" | "unknown" | "none";
export type OutreachStatus = "new" | "contacted" | "replied" | "not_interested" | "won";

export interface Audit {
  has_site?: boolean;
  reachable?: boolean;
  https?: boolean;
  mobile?: boolean;
  booking?: boolean;
  booking_via?: string;
  chat?: boolean;
  whatsapp?: boolean;
  form?: boolean;
  slow?: boolean;
  load_ms?: number | null;
}

export interface Outreach {
  status: OutreachStatus;
  sent: string;
  channel: string;
  campaign: string;
  note: string;
}

export interface EmailCheck {
  address: string;
  verdict: "valid" | "risky" | "invalid" | "unknown";
  reason: string;
  mx?: string;
  smtp?: number | null;
  catch_all?: boolean | null;
  checked_at?: string;
}

export interface PhoneCheck {
  e164: string;
  display: string;
  type: string;
  region: string;
  found_on: string;
}

export interface Person {
  name: string;
  title: string;
  url: string;
  via: string;
}

export interface Lead {
  id: string;
  name: string;
  niche: string;
  category: string;
  country: string;
  city: string;
  region: string;
  address: string;
  lat: number | null;
  lon: number | null;
  phones: string[];
  whatsapp: string;
  email: string;
  other_emails: string[];
  email_status: EmailStatus;
  mx: string;
  website: string;
  audit: Audit;
  maps: { rating?: number; reviews?: number; hours?: string; url?: string };
  socials: Record<string, string>;
  ads: boolean | null;
  ads_count?: number;
  size: string;
  sources: string[];
  datasets: string[];
  outreach: Outreach;
  score: number;
  score_parts: { reach: number; gap: number; established: number };
  reasons: [string, string][];
  found_at?: string;
  search_id?: string;
  checks?: { emails: EmailCheck[]; phones: PhoneCheck[] };
  people?: Person[];
  registry?: { siren: string; legal_name: string; created: string; staff: string | null; activity: string; directors: string[] } | null;
  domain?: { domain: string; registered?: string; first_archived?: string } | null;
  trustpilot?: { url: string; score: number | null; reviews: number | null; complaints: string[] } | null;
  profiles?: Record<string, string>;
  instagram?: { url: string; username?: string; followers?: number; following?: number; posts?: number; bio?: string; category?: string | null; via?: string } | null;
  angle?: string;
  agent?: { researched_at: string; model: string; evidence: string[] };
}

export interface ApiKey {
  name: string;
  label: string;
  free: string;
  url: string;
  unlocks: string[];
  set: boolean;
  hint: string;
}

export interface AgentPlan {
  searches: { niche: string; location: string; country: string; limit: number; why: string }[];
  notes: string;
  model: string;
}

export interface ResearchJob {
  state: "idle" | "running" | "done" | "error";
  steps: { ts: string; kind: string; text: string }[];
  error?: string | null;
}

export interface LeadsFile {
  generated_at: string;
  rules_version: string;
  known: { businesses: number; files: { file: string; rows: number }[] };
  leads: Lead[];
}

export interface SearchProgress {
  step?: string;
  pct?: number;
  found?: number;
  known?: number;
  already?: number;
  total?: number;
  checked?: number;
  saved?: number;
  new?: number;
  no_contact?: number;
  emails_valid?: number;
  emails_risky?: number;
  phones_valid?: number;
  intent?: { title: string; url: string; snippet: string }[];
  source_errors?: Record<string, string>;
}

export interface EngineSearch {
  id: string;
  params: { niche: string; location: string; country: string; limit: number; sources: string[] };
  created: string;
  state: "queued" | "running" | "done" | "error";
  progress: SearchProgress;
  last_run: string | null;
  last_error: string | null;
  running: boolean;
  events: { ts: string; level: string; message: string }[];
}

export type HealthStatus = "ok" | "partial" | "blocked" | "needs_key" | "error" | "testing";

export interface SourceHealth {
  status: HealthStatus;
  detail: string;
  checked_at: string;
}
