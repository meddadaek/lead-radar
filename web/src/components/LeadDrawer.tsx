import { Check, Copy, ExternalLink, Globe, Mail, MapPin, MessageCircle, Minus, Phone, RotateCw, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { COUNTRIES, EMAIL_LABEL, EMAIL_TONE, SOURCE_GROUPS, STATUS_LABEL, engine, formatDate, store } from "../lib/data";
import type { Audit, Lead, OutreachStatus, ResearchJob } from "../lib/types";
import { Button, CountryCode, EASE, Hud, Pill, SCORE_COLOR, ScoreRing } from "./ui";
import { scoreTone } from "../lib/data";

export function LeadDrawer({ lead, onClose, onChanged }: { lead: Lead | null; onClose: () => void; onChanged: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <AnimatePresence>
      {lead && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-[1000] bg-black/55 backdrop-blur-[3px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            key="drawer"
            className="glass fixed bottom-3 right-3 top-3 z-[1001] flex w-[calc(100%-24px)] max-w-[560px] flex-col overflow-hidden rounded-[26px] !bg-[#070a12]/90"
            initial={{ x: "110%", opacity: 0.6 }} animate={{ x: 0, opacity: 1 }} exit={{ x: "110%", opacity: 0.6 }}
            transition={{ type: "spring", stiffness: 300, damping: 34 }}
          >
            <DrawerBody key={lead.id} lead={lead} onClose={onClose} onChanged={onChanged} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

const list: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.15 } } };
const item: Variants = {
  hidden: { opacity: 0, y: 16, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.55, ease: EASE }, transitionEnd: { filter: "none" } },
};

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <motion.section variants={item} className="mx-4 mb-3 rounded-2xl border border-line bg-white/[0.02] px-4 py-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <Hud accent>{title}</Hud>
        {aside}
      </div>
      {children}
    </motion.section>
  );
}

function Row({ icon, label, children }: { icon?: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5 text-[13px]">
      <div className="flex w-24 shrink-0 items-center gap-2 text-faint">
        {icon}
        {label}
      </div>
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

function Pending({ what }: { what: string }) {
  return (
    <p className="flex items-center gap-2 text-[12.5px] text-faint">
      <span className="h-1.5 w-1.5 rounded-full border border-dashed border-faint" />
      Not collected yet · {what}
    </p>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
      className="inline-grid h-6 w-6 cursor-pointer place-items-center rounded-md text-faint transition hover:bg-white/[0.06] hover:text-text"
      title="Copy"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={String(done)} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>
          {done ? <Check className="h-3.5 w-3.5 text-good" /> : <Copy className="h-3.5 w-3.5" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

const AUDIT_ROWS: [keyof Audit, string][] = [
  ["reachable", "Site loads"], ["https", "HTTPS"], ["mobile", "Mobile-friendly"], ["booking", "Online booking"],
  ["form", "Contact form"], ["chat", "Live chat"], ["whatsapp", "WhatsApp button"],
];

const STATUSES: OutreachStatus[] = ["new", "contacted", "replied", "won", "not_interested"];
const link = "text-text underline decoration-white/20 underline-offset-[3px] transition hover:decoration-accent";
const TONE_VAR: Record<string, string> = { good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)", neutral: "var(--faint)" };

function AgentResearch({ lead, onChanged }: { lead: Lead; onChanged: () => void }) {
  const [job, setJob] = useState<ResearchJob | null>(null);
  const [error, setError] = useState("");
  const running = job?.state === "running";

  useEffect(() => {
    engine.researchStatus(lead.id).then(setJob).catch(() => undefined);
  }, [lead.id]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      try {
        const j = await engine.researchStatus(lead.id);
        setJob(j);
        if (j.state !== "running") onChanged();
      } catch {
        /* keep polling */
      }
    }, 1500);
    return () => clearInterval(t);
  }, [running, lead.id, onChanged]);

  return (
    <motion.section variants={item} className="relative mx-4 mb-3 overflow-hidden rounded-2xl border border-violet/30 bg-violet/[0.05] px-4 py-3.5">
      {running && <div className="scanline pointer-events-none absolute inset-0" />}
      <div className="flex items-center justify-between gap-3">
        <Hud accent>AI research</Hud>
        <Button
          variant={lead.agent ? "ghost" : "primary"}
          disabled={running}
          onClick={async () => {
            setError("");
            try {
              await engine.research(lead.id);
              setJob({ state: "running", steps: [] });
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {running ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {running ? "Researching…" : lead.agent ? "Research again" : "Research with AI"}
        </Button>
      </div>
      {!job?.steps.length && !lead.agent && !error && (
        <p className="mt-2 text-[12.5px] text-muted">The agent searches the web for the owner, direct emails and official profiles, keeps only what its sources show, then confirms each email with the mail server.</p>
      )}
      {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
      {lead.angle && (
        <div className="mt-3 rounded-xl border border-line bg-black/25 px-3 py-2.5">
          <Hud>Outreach angle</Hud>
          <p className="mt-1 text-[13px] leading-relaxed">{lead.angle}</p>
        </div>
      )}
      {(job?.steps.length ?? 0) > 0 && (
        <ul className="scroll-thin mt-3 max-h-44 space-y-1 overflow-y-auto font-mono text-[11px]">
          {job!.steps.map((s, i) => (
            <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
              className={s.kind === "done" ? "text-good" : s.kind === "error" || s.kind === "warn" ? "text-warn" : s.kind === "verify" ? "text-cyan" : "text-muted"}>
              › {s.text}
            </motion.li>
          ))}
        </ul>
      )}
      {lead.agent && (
        <details className="mt-2 text-[11px] text-faint">
          <summary className="cursor-pointer hover:text-muted">Sources the agent read · {lead.agent.model} · {formatDate(lead.agent.researched_at)}</summary>
          <ul className="mt-1 space-y-0.5">
            {lead.agent.evidence.map((u) => (
              <li key={u} className="truncate"><a className="hover:text-text" href={u} target="_blank" rel="noreferrer">{u}</a></li>
            ))}
          </ul>
        </details>
      )}
    </motion.section>
  );
}

function DrawerBody({ lead, onClose, onChanged }: { lead: Lead; onClose: () => void; onChanged: () => void }) {
  const [note, setNote] = useState(lead.outreach.note);
  useEffect(() => {
    if (note === lead.outreach.note) return;
    const t = setTimeout(() => store.setNote(lead.id, note), 400);
    return () => clearTimeout(t);
  }, [note, lead.id, lead.outreach.note]);

  const a = lead.audit;
  const place = [lead.address, lead.city, lead.region].filter(Boolean).join(", ");
  const mapsUrl = lead.maps.url
    || (lead.lat != null ? `https://www.google.com/maps/search/?api=1&query=${lead.lat},${lead.lon}` : "")
    || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([lead.name, lead.city].join(" "))}`;
  const pending = SOURCE_GROUPS.flatMap((g) => g.items.map((i) => i.name)).filter((s) => !lead.sources.includes(s));
  const parts = lead.score_parts;
  const color = SCORE_COLOR[scoreTone(lead.score)];

  return (
    <>
      <div className="relative overflow-hidden px-6 pb-5 pt-6">
        <motion.div
          className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full blur-3xl"
          style={{ background: `radial-gradient(circle, ${color}33, transparent 65%)` }}
          initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.2, ease: EASE }}
        />
        <motion.div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
          initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.9, ease: EASE }}
        />
        <div className="relative flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="flex flex-wrap items-center gap-1.5">
              <CountryCode code={lead.country} />
              <Pill>{lead.niche}</Pill>
              {lead.size && <Pill>{lead.size}</Pill>}
              <span className="hud ml-1 !text-[9px]">{lead.id}</span>
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 12, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ delay: 0.15, duration: 0.7, ease: EASE }}
              className="mt-3 text-[26px] font-semibold leading-[1.1] tracking-[-0.02em]"
            >
              {lead.name}
            </motion.h2>
            <p className="mt-1.5 text-[13px] text-muted">{[lead.category, lead.city, COUNTRIES[lead.country]].filter(Boolean).join(" · ")}</p>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full border border-line text-muted transition hover:rotate-90 hover:border-line-strong hover:text-text" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <motion.div variants={list} initial="hidden" animate="show" className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-4">
        <Section title="Fit score" aside={<span className="font-mono text-[10px] text-faint">rules v0 · not AI</span>}>
          <div className="flex items-center gap-5">
            <ScoreRing score={lead.score} />
            <div className="flex-1 space-y-3">
              {([["Reach", parts.reach, 40, "#3ee6ff"], ["Gap to fix", parts.gap, 40, "#c8f542"], ["Established", parts.established, 20, "#9b8cff"]] as const).map(([label, v, max, c], i) => (
                <div key={label}>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted">{label}</span>
                    <span className="font-mono tabular text-text">{v}<span className="text-faint">/{max}</span></span>
                  </div>
                  <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-white/[0.06]">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: `linear-gradient(90deg, ${c}33, ${c})`, boxShadow: `0 0 10px ${c}` }}
                      initial={{ width: 0 }} animate={{ width: `${(v / max) * 100}%` }} transition={{ duration: 0.9, delay: 0.35 + i * 0.1, ease: EASE }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <ul className="mt-4 space-y-1.5 border-t border-line pt-3">
            {lead.reasons.map(([pts, text], i) => (
              <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 + i * 0.05 }} className="flex gap-3 text-[13px]">
                <span className={`w-8 shrink-0 text-right font-mono text-xs leading-5 tabular ${pts.startsWith("+") ? "text-accent-text" : "text-bad"}`}>{pts}</span>
                <span className="text-text/90">{text}</span>
              </motion.li>
            ))}
          </ul>
        </Section>

        <Section title="Outreach">
          <div className="relative flex flex-wrap gap-1 rounded-full border border-line bg-black/20 p-1">
            {STATUSES.map((s) => {
              const active = lead.outreach.status === s;
              return (
                <button
                  key={s}
                  onClick={() => store.setStatus([lead.id], s)}
                  className={`relative h-8 flex-1 cursor-pointer whitespace-nowrap rounded-full px-2.5 text-[11.5px] transition ${active ? "font-semibold text-accent-ink" : "text-muted hover:text-text"}`}
                >
                  {active && <motion.span layoutId={`status-${lead.id}`} className="absolute inset-0 rounded-full bg-accent shadow-[0_0_20px_-4px_var(--accent)]" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                  <span className="relative">{STATUS_LABEL[s]}</span>
                </button>
              );
            })}
          </div>
          {lead.outreach.sent && (
            <p className="mt-3 text-[12.5px] text-muted">
              Sent <span className="text-text">{formatDate(lead.outreach.sent)}</span> by {lead.outreach.channel || "email"}
              {lead.outreach.campaign && <> · <span className="font-mono text-[11px] text-faint">{lead.outreach.campaign}</span></>}
            </p>
          )}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Notes: who you spoke to, what they said, next step…"
            rows={3}
            className="mt-3 w-full resize-y rounded-xl border border-line bg-black/25 px-3 py-2.5 text-[13px] outline-none transition placeholder:text-faint focus:border-accent/50 focus:shadow-[0_0_24px_-12px_var(--accent)]"
          />
          <p className="mt-1 text-[10.5px] text-faint">Status and notes save automatically in this browser.</p>
        </Section>

        <Section title="Contact">
          <Row icon={<Mail className="h-3.5 w-3.5" />} label="Email">
            {lead.email ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <a className={link} href={`mailto:${lead.email}`}>{lead.email}</a>
                <Pill tone={EMAIL_TONE[lead.email_status]}>
                  <span className="h-1 w-1 rounded-full" style={{ background: TONE_VAR[EMAIL_TONE[lead.email_status]] }} />
                  {EMAIL_LABEL[lead.email_status]}
                </Pill>
                <CopyButton text={lead.email} />
              </span>
            ) : (
              <span className="text-faint">None found</span>
            )}
          </Row>
          {lead.other_emails.length > 0 && (
            <Row label="Other">
              <span className="text-muted">{lead.other_emails.join(", ")}</span>
            </Row>
          )}
          <Row icon={<Phone className="h-3.5 w-3.5" />} label="Phone">
            {lead.phones.length ? (
              <span className="flex flex-col gap-0.5">
                {lead.phones.map((p) => (
                  <a key={p} className={`${link} font-mono text-xs`} href={`tel:${p.replace(/\s/g, "")}`}>{p}</a>
                ))}
              </span>
            ) : (
              <span className="text-faint">None found</span>
            )}
          </Row>
          <Row icon={<MessageCircle className="h-3.5 w-3.5" />} label="WhatsApp">
            {lead.whatsapp ? (
              <a className={`${link} font-mono text-xs`} href={`https://wa.me/${lead.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                +{lead.whatsapp.replace(/\D/g, "")}
              </a>
            ) : (
              <span className="text-faint">None found</span>
            )}
          </Row>
          <Row icon={<Globe className="h-3.5 w-3.5" />} label="Website">
            {lead.website ? (
              <a className={`${link} inline-flex items-center gap-1`} href={lead.website} target="_blank" rel="noreferrer">
                {lead.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                <ExternalLink className="h-3 w-3 text-faint" />
              </a>
            ) : (
              <span className="text-faint">{a.has_site === false ? "No website" : "None found"}</span>
            )}
          </Row>
          {lead.mx && (
            <Row label="Mail server">
              <span className="font-mono text-[11px] text-muted">{lead.mx}</span>
            </Row>
          )}
          <Row icon={<MapPin className="h-3.5 w-3.5" />} label="Address">
            <span>
              {place || <span className="text-faint">Not recorded</span>}
              <a className="ml-2 inline-flex items-center gap-1 text-xs text-accent-text hover:underline" href={mapsUrl} target="_blank" rel="noreferrer">
                Maps <ExternalLink className="h-3 w-3" />
              </a>
            </span>
          </Row>
        </Section>

        <Section title="Website audit">
          {a.has_site === false ? (
            <div className="flex items-start gap-3 rounded-xl border border-accent/25 bg-accent/[0.06] p-3">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]" />
              <p className="text-[13px]">
                <span className="font-medium text-accent-text">No website.</span>{" "}
                <span className="text-muted">That's the gap: anyone searching for them online finds nothing.</span>
              </p>
            </div>
          ) : a.reachable === undefined && a.booking === undefined ? (
            <Pending what="the audit runs when the engine crawls the site" />
          ) : (
            <div className="grid grid-cols-2 gap-x-4">
              {AUDIT_ROWS.map(([key, label], i) => {
                const v = a[key];
                return (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.04 }}
                    className="flex items-center justify-between border-b border-white/[0.05] py-2 text-[13px]"
                  >
                    <span className="text-muted">{label}</span>
                    {v === true ? (
                      <Check className="h-4 w-4 text-good" style={{ filter: "drop-shadow(0 0 5px var(--good))" }} />
                    ) : v === false ? (
                      <X className="h-4 w-4 text-bad" style={{ filter: "drop-shadow(0 0 5px var(--bad))" }} />
                    ) : (
                      <Minus className="h-4 w-4 text-faint" />
                    )}
                  </motion.div>
                );
              })}
              {a.load_ms != null && (
                <div className="flex items-center justify-between border-b border-white/[0.05] py-2 text-[13px]">
                  <span className="text-muted">Load time</span>
                  <span className={`font-mono text-xs ${a.load_ms > 4000 ? "text-bad" : "text-good"}`}>{(a.load_ms / 1000).toFixed(1)}s</span>
                </div>
              )}
            </div>
          )}
        </Section>

        <Section title="Google Maps">
          {lead.maps.rating || lead.maps.reviews || lead.maps.hours ? (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-line bg-black/20 p-3">
                <Hud>Rating</Hud>
                <div className="mt-1 font-mono text-lg text-warn">{lead.maps.rating != null ? `★ ${lead.maps.rating.toFixed(1)}` : "—"}</div>
              </div>
              <div className="rounded-xl border border-line bg-black/20 p-3">
                <Hud>Reviews</Hud>
                <div className="mt-1 font-mono text-lg">{lead.maps.reviews ?? "—"}</div>
              </div>
              <div className="rounded-xl border border-line bg-black/20 p-3">
                <Hud>Hours</Hud>
                <div className="mt-1 truncate text-[12px] text-muted" title={lead.maps.hours}>{lead.maps.hours || "—"}</div>
              </div>
            </div>
          ) : (
            <Pending what="rating, reviews and hours" />
          )}
        </Section>

        <Section title="Social & ads">
          {lead.instagram && (lead.instagram.followers != null || lead.instagram.posts != null) && (
            <div className="mb-2 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-line bg-black/20 p-3">
                <Hud>Instagram</Hud>
                <div className="mt-1 font-mono text-lg">{lead.instagram.followers != null ? lead.instagram.followers.toLocaleString("en-US") : "–"}</div>
                <div className="text-[10px] text-faint">followers</div>
              </div>
              <div className="rounded-xl border border-line bg-black/20 p-3">
                <Hud>Posts</Hud>
                <div className="mt-1 font-mono text-lg">{lead.instagram.posts ?? "–"}</div>
              </div>
              <div className="rounded-xl border border-line bg-black/20 p-3">
                <Hud>Category</Hud>
                <div className="mt-1 truncate text-[12px] text-muted" title={lead.instagram.bio}>{lead.instagram.category || (lead.instagram.via ? "from search" : "—")}</div>
              </div>
            </div>
          )}
          {Object.keys(lead.socials).length > 0 ? (
            Object.entries(lead.socials).map(([k, v]) => (
              <Row key={k} label={k[0].toUpperCase() + k.slice(1)}>
                <a className={link} href={v.startsWith("http") ? v : `https://${v}`} target="_blank" rel="noreferrer">
                  {v.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              </Row>
            ))
          ) : (
            <Pending what="Facebook, Instagram, TikTok" />
          )}
          <Row label="Meta ads">
            {lead.ads ? <Pill tone="accent">Running ads now</Pill> : <span className="text-faint">Not checked yet</span>}
          </Row>
        </Section>

        <AgentResearch lead={lead} onChanged={onChanged} />

        <Section title="Verification" aside={<span className="font-mono text-[10px] text-faint">nothing was sent</span>}>
          {(lead.checks?.emails.length ?? 0) === 0 && (lead.checks?.phones.length ?? 0) === 0 ? (
            <Pending what="no email or phone to check" />
          ) : (
            <ul className="space-y-2">
              {lead.checks?.emails.map((c) => (
                <li key={c.address} className="flex items-start gap-3 rounded-xl border border-line bg-black/20 px-3 py-2">
                  <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="font-mono text-[12px]">{c.address}</span>
                      <Pill tone={c.verdict === "valid" ? "good" : c.verdict === "invalid" ? "bad" : "warn"}>{c.verdict === "valid" ? "Verified" : c.verdict === "invalid" ? "Bounces" : "Unconfirmable"}</Pill>
                    </div>
                    <div className="mt-0.5 text-[11px] text-faint">
                      {c.reason}{c.mx ? ` · ${c.mx}` : ""}{c.smtp ? ` · SMTP ${c.smtp}` : ""}{c.checked_at ? ` · ${formatDate(c.checked_at)}` : ""}
                    </div>
                  </div>
                </li>
              ))}
              {lead.checks?.phones.map((p) => (
                <li key={p.e164} className="flex items-start gap-3 rounded-xl border border-line bg-black/20 px-3 py-2">
                  <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="font-mono text-[12px]">{p.display}</span>
                      <Pill tone="good">Valid {p.type}</Pill>
                    </div>
                    <div className="mt-0.5 text-[11px] text-faint">Valid number format for {p.region} · found on {p.found_on}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="People">
          {(lead.people?.length ?? 0) > 0 ? (
            <ul className="space-y-1.5">
              {lead.people!.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0">
                    {p.url ? <a className={link} href={p.url} target="_blank" rel="noreferrer">{p.name}</a> : p.name}
                    {p.title && <span className="text-muted"> · {p.title}</span>}
                  </span>
                  <span className="hud shrink-0 !text-[9px]">{p.via}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Pending what="no owner or decision maker found yet" />
          )}
        </Section>

        {(lead.registry || lead.domain || lead.trustpilot || lead.profiles?.doctolib || lead.profiles?.ad_library) && (
          <Section title="Company intel">
            {lead.registry && (
              <>
                <Row label="Legal name">{lead.registry.legal_name}</Row>
                <Row label="SIREN"><span className="font-mono text-xs">{lead.registry.siren}</span></Row>
                {lead.registry.created && <Row label="Created">{formatDate(lead.registry.created)}</Row>}
              </>
            )}
            {lead.domain?.registered && <Row label="Domain since">{formatDate(lead.domain.registered)}</Row>}
            {lead.domain?.first_archived && <Row label="First archived">{lead.domain.first_archived.replace(/(\d{4})(\d{2})(\d{2})/, "$3/$2/$1")}</Row>}
            {lead.trustpilot && (
              <Row label="Trustpilot">
                <a className={link} href={lead.trustpilot.url} target="_blank" rel="noreferrer">
                  {lead.trustpilot.score ?? "–"} / 5 · {lead.trustpilot.reviews ?? 0} reviews
                </a>
                {lead.trustpilot.complaints.map((c, i) => <p key={i} className="mt-1 text-[11.5px] text-faint">“{c}”</p>)}
              </Row>
            )}
            {lead.profiles?.doctolib && (
              <Row label="Doctolib">
                <a className={`${link} inline-flex items-center gap-1`} href={lead.profiles.doctolib} target="_blank" rel="noreferrer">Booking page <ExternalLink className="h-3 w-3 text-faint" /></a>
              </Row>
            )}
            {lead.profiles?.ad_library && (
              <Row label="Ad Library">
                <a className={`${link} inline-flex items-center gap-1`} href={lead.profiles.ad_library} target="_blank" rel="noreferrer">
                  {lead.ads_count ?? 0} active ads <ExternalLink className="h-3 w-3 text-faint" />
                </a>
              </Row>
            )}
          </Section>
        )}

        <Section title="Signal sources">
          <div className="flex flex-wrap gap-1.5">
            {lead.sources.map((s) => (
              <Pill key={s} tone="accent">{s}</Pill>
            ))}
            {pending.map((s) => (
              <span key={s} className="rounded-full border border-dashed border-line-strong px-2 py-[3px] text-[10.5px] text-faint">{s}</span>
            ))}
          </div>
          <p className="mt-3 font-mono text-[10px] text-faint">
            solid = collected · dashed = waiting for engine · {lead.datasets.join(", ")}
          </p>
        </Section>
      </motion.div>
    </>
  );
}
