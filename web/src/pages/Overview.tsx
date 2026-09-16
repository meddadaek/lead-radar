import { ArrowRight, Search } from "lucide-react";
import { motion, type Variants } from "motion/react";
import { useMemo, useState } from "react";
import { Globe } from "../components/Globe";
import { Button, CountUp, EASE, GlowCard, Hud, Kbd, Pill, SCORE_COLOR } from "../components/ui";
import { COUNTRIES, EMAIL_LABEL, SOURCE_GROUPS, STATUS_LABEL, STATUS_TONE, fmt, formatDate, scoreTone } from "../lib/data";
import type { EmailStatus, Lead, LeadsFile, OutreachStatus } from "../lib/types";
import type { Filters } from "./Leads";
import type { Page } from "../components/Shell";

const PALETTE = ["#c8f542", "#3ee6ff", "#9b8cff", "#ff8fc7", "#ffb547", "#3ef08a", "#ff5c7a", "#8b95a7"];

function countBy<T>(items: T[], key: (t: T) => string) {
  const m = new Map<string, number>();
  items.forEach((i) => m.set(key(i), (m.get(key(i)) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } } };
const rise: Variants = {
  hidden: { opacity: 0, y: 26, filter: "blur(10px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.9, ease: EASE }, transitionEnd: { filter: "none" } },
};

type Go = (f: Partial<Filters>) => void;

export function Overview({
  file, leads, onFilter, onOpen, onNavigate,
}: { file: LeadsFile; leads: Lead[]; onFilter: Go; onOpen: (id: string) => void; onNavigate: (p: Page) => void }) {
  const d = useMemo(() => {
    const total = leads.length;
    const countries = countBy(leads, (l) => l.country).map(([code, value]) => ({ code, name: COUNTRIES[code] ?? code, value }));
    const buckets = Array.from({ length: 10 }, (_, i) => ({
      start: i * 10,
      label: i === 9 ? "90+" : `${i * 10}`,
      value: leads.filter((l) => Math.min(9, Math.floor(l.score / 10)) === i).length,
    }));
    const email = (["valid", "risky", "invalid", "none"] as EmailStatus[]).map((k) => ({
      key: k,
      value: leads.filter((l) => (k === "none" ? l.email_status === "none" || l.email_status === "unknown" : l.email_status === k)).length,
    }));
    return {
      total,
      valid: leads.filter((l) => l.email_status === "valid").length,
      contacted: leads.filter((l) => l.outreach.status !== "new").length,
      hot: leads.filter((l) => l.score >= 60 && l.outreach.status === "new").length,
      noSite: leads.filter((l) => l.audit.has_site === false && l.outreach.status === "new").length,
      countries,
      niches: countBy(leads, (l) => l.niche).map(([name, value]) => ({ name, value })),
      buckets,
      email,
      days: countBy(leads.filter((l) => l.found_at), (l) => (l.found_at || "").slice(0, 10)).map(([day, value]) => ({ day, value })).sort((a, b) => a.day.localeCompare(b.day)),
      phones: leads.filter((l) => l.phones.length).length,
      statuses: countBy(leads, (l) => l.outreach.status) as [OutreachStatus, number][],
      sources: countBy(leads.flatMap((l) => l.sources.map((s) => ({ s }))), (x) => x.s),
    };
  }, [leads]);

  if (leads.length === 0) {
    return (
      <div className="pb-16">
        <Hero file={file} d={d} leads={leads} onFilter={onFilter} onOpen={onOpen} onNavigate={onNavigate} />
        <div className="mx-auto max-w-[1400px] px-4 md:px-8">
          <GlowCard kicker="Exclusion list" title="Past campaigns are never shown again" hint={`${fmt(file.known.businesses)} businesses from ${file.known.files.length} old files are skipped automatically by every search, matched by email, website, phone and name.`}>
            <FileLog datasets={file.known.files} />
          </GlowCard>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-16">
      <Hero file={file} d={d} leads={leads} onFilter={onFilter} onOpen={onOpen} onNavigate={onNavigate} />

      <div className="mx-auto max-w-[1400px] px-4 md:px-8">
        <SectionHead index="02" title={`What the ${fmt(d.total)} leads look like`} note="Every chart is live. Click any ring, bar or row to open the matching leads." />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <GlowCard className="lg:col-span-5" kicker="Markets" title="Where they are" hint="Each ring is one country's share of all leads.">
            <CountryRings data={d.countries} total={d.total} onPick={(code) => onFilter({ country: code })} />
          </GlowCard>

          <GlowCard className="lg:col-span-7" delay={0.08} kicker="Verticals" title="What kind of businesses" hint="Hospitality and medical lead because the first campaigns targeted them.">
            <NicheBars data={d.niches} onPick={(niche) => onFilter({ niche })} />
          </GlowCard>

          <GlowCard className="lg:col-span-7" kicker="Fit score" title="Score distribution" hint="Score = can we reach them (40) + a visible problem to fix (40) + an established business (20). Click a band to open everything from that score up.">
            <ScoreBands data={d.buckets} onPick={(minScore) => onFilter({ minScore })} />
          </GlowCard>

          <GlowCard className="lg:col-span-5" delay={0.08} kicker="Deliverability" title="Email quality" hint="Checked against each mail server. No message was sent to check.">
            <EmailGauge data={d.email} total={d.total} onPick={(email) => onFilter({ email })} />
          </GlowCard>

          <GlowCard
            className="lg:col-span-7" kicker="Activity" title="New leads found per day"
            hint="Each bar is the number of confirmed new businesses the engine saved that day."
            right={<div className="hidden flex-wrap justify-end gap-1.5 sm:flex">{d.statuses.map(([s, n]) => <Pill key={s} tone={STATUS_TONE[s]}>{STATUS_LABEL[s]} · {fmt(n)}</Pill>)}</div>}
          >
            <Timeline days={d.days} />
          </GlowCard>

          <GlowCard className="lg:col-span-5" delay={0.08} kicker="Sources" title="Where the data came from" hint="Dashed sources are planned and come online with the engine.">
            <SourceList sources={d.sources} total={d.total} />
          </GlowCard>

          <GlowCard className="lg:col-span-12" kicker="Exclusion list" title="Past campaigns, never shown again" hint={`${fmt(file.known.businesses)} businesses from ${file.known.files.length} old files are skipped by every search.`}>
            <FileLog datasets={file.known.files} />
          </GlowCard>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== hero */

function Hero({
  file, d, leads, onFilter, onOpen, onNavigate,
}: {
  file: LeadsFile; d: { total: number; valid: number; phones: number; hot: number; noSite: number; countries: { code: string }[] };
  leads: Lead[]; onFilter: Go; onOpen: (id: string) => void; onNavigate: (p: Page) => void;
}) {
  const routes = d.countries.filter((c) => c.code !== "DZ").length;
  const empty = d.total === 0;
  return (
    <section className="relative mx-auto max-w-[1480px]">
      <div className="relative flex flex-col lg:block lg:h-[min(800px,calc(100vh-56px))] lg:min-h-[640px]">
        {/* globe: the centrepiece */}
        <div className="relative order-2 h-[440px] sm:h-[560px] lg:absolute lg:inset-y-0 lg:right-[-3%] lg:h-auto lg:w-[66%]">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 2 }}
            className="pointer-events-none absolute inset-[14%] rounded-full bg-[radial-gradient(circle,rgba(62,230,255,0.18),rgba(200,245,66,0.05)_45%,transparent_68%)] blur-2xl"
          />
          <Globe leads={leads} onOpen={onOpen} className="absolute inset-0" />

          <div className="pointer-events-none absolute inset-0 hidden lg:block">
            <FloatChip className="left-[6%] top-[15%]" delay={1.3} float={6}>
              <Hud accent>Hot &amp; untouched</Hud>
              <button onClick={() => onFilter({ minScore: 60, status: "new" })} className="pointer-events-auto mt-2 flex cursor-pointer items-end gap-2 text-left">
                <span className="accent-gradient-text text-3xl font-semibold tracking-tight"><CountUp value={d.hot} /></span>
                <ArrowRight className="mb-1.5 h-4 w-4 text-accent-text" />
              </button>
              <p className="mt-1 text-[11px] text-faint">Score 60+, never contacted</p>
            </FloatChip>

            <FloatChip className="right-[8%] top-[24%]" delay={1.5} float={7.5}>
              <Hud>Verified emails</Hud>
              <button onClick={() => onFilter({ email: "valid" })} className="pointer-events-auto mt-2 block cursor-pointer text-left">
                <span className="text-3xl font-semibold tracking-tight text-good"><CountUp value={d.valid} /></span>
              </button>
              <p className="mt-1 text-[11px] text-faint">Mailbox confirmed, won't bounce</p>
            </FloatChip>

            <FloatChip className="bottom-[16%] right-[6%]" delay={1.7} float={8}>
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="ping-soft absolute inline-flex h-full w-full rounded-full bg-accent" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
                </span>
                <Hud>Home base · Algiers</Hud>
              </div>
              <p className="mt-1.5 text-[12px] text-muted"><span className="font-mono text-text">{routes}</span> outreach routes to international markets</p>
            </FloatChip>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2, duration: 0.8 }}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 flex-wrap items-center justify-center gap-x-4 gap-y-1 whitespace-nowrap rounded-full border border-line bg-black/30 px-4 py-2 backdrop-blur-md"
          >
            {([["accent", "60+"], ["good", "40+"], ["warn", "20+"], ["neutral", "<20"]] as const).map(([tone, label]) => (
              <span key={tone} className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: SCORE_COLOR[tone], boxShadow: `0 0 8px ${SCORE_COLOR[tone]}` }} />
                {label}
              </span>
            ))}
            <span className="hidden text-[10px] text-faint sm:inline">Drag to rotate · click a dot</span>
          </motion.div>
        </div>

        {/* copy */}
        <div className="pointer-events-none relative z-10 order-1 flex flex-col justify-center px-4 pt-6 md:px-8 lg:h-full lg:max-w-[600px] lg:pt-0">
          <motion.div variants={stagger} initial="hidden" animate="show" className="pointer-events-auto">
            <motion.div variants={rise}>
              <Hud accent>Live index · {formatDate(file.generated_at)}</Hud>
            </motion.div>
            <motion.h1 variants={rise} className="mt-5 text-[46px] font-semibold leading-[0.95] tracking-[-0.04em] sm:text-[64px] xl:text-[80px]">
              <span className="gradient-text"><CountUp value={d.total} duration={2.2} /></span>
              <br />
              <span className="accent-gradient-text">new leads</span>{" "}
              <span className="text-white/35">on radar.</span>
            </motion.h1>
            <motion.p variants={rise} className="mt-6 max-w-md text-[15px] leading-relaxed text-muted">
              {empty
                ? `Nothing yet. Start a search: the engine finds businesses, confirms their email and phone, and skips the ${fmt(file.known.businesses)} businesses from past campaigns.`
                : `Every lead was found by the engine, has a confirmed contact, and is not one of the ${fmt(file.known.businesses)} businesses from past campaigns.`}
            </motion.p>
            <motion.div variants={rise} className="mt-8 flex flex-wrap items-center gap-3">
              {empty ? (
                <Button variant="primary" onClick={() => onNavigate("searches")}>
                  Run your first search <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <>
                  <Button variant="primary" onClick={() => onFilter({ minScore: 60, status: "new" })}>
                    Open hot leads <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button onClick={() => onNavigate("searches")}>
                    <Search className="h-3.5 w-3.5" /> New search <Kbd>Ctrl K</Kbd>
                  </Button>
                </>
              )}
            </motion.div>
            <motion.div variants={rise} className="mt-10 grid max-w-lg grid-cols-3 overflow-hidden rounded-2xl border border-line bg-black/20 backdrop-blur-md">
              {[
                { label: "Valid phones", value: d.phones, go: () => onFilter({}) },
                { label: "No website", value: d.noSite, go: () => onFilter({ site: "none", status: "new" }) },
                { label: "Markets", value: d.countries.length, go: () => onFilter({}) },
              ].map((s, i) => (
                <button key={s.label} onClick={s.go} className={`group cursor-pointer px-4 py-3.5 text-left transition hover:bg-white/[0.04] ${i ? "border-l border-line" : ""}`}>
                  <Hud className="group-hover:!text-muted">{s.label}</Hud>
                  <div className="mt-1.5 text-xl font-semibold tracking-tight"><CountUp value={s.value} /></div>
                </button>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function FloatChip({ children, className, delay, float }: { children: React.ReactNode; className: string; delay: number; float: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85, y: 16, filter: "blur(8px)" }}
      animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      transition={{ delay, duration: 0.9, ease: EASE }}
      className={`absolute ${className}`}
    >
      <motion.div animate={{ y: [0, -9, 0] }} transition={{ duration: float, repeat: Infinity, ease: "easeInOut" }} className="glass brackets rounded-2xl px-4 py-3.5">
        <span className="br tl" /><span className="br tr" /><span className="br bl" /><span className="br brr" />
        {children}
      </motion.div>
    </motion.div>
  );
}

function SectionHead({ index, title, note }: { index: string; title: string; note: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8, ease: EASE }}
      className="mb-5 mt-6 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-8 lg:mt-2"
    >
      <div>
        <Hud accent>{index} — Signal breakdown</Hud>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">{title}</h2>
      </div>
      <p className="max-w-sm text-xs text-muted">{note}</p>
    </motion.div>
  );
}

/* ================================================================== charts */

function CountryRings({ data, total, onPick }: { data: { code: string; name: string; value: number }[]; total: number; onPick: (c: string) => void }) {
  const [active, setActive] = useState<string | null>(null);
  const rows = data.slice(0, 8);
  const S = 240, cx = 120;
  return (
    <div className="flex flex-col items-center gap-4 px-5 pb-5 pt-3 sm:flex-row">
      <svg viewBox={`0 0 ${S} ${S}`} className="h-[230px] w-[230px] shrink-0">
        {rows.map((d, i) => {
          const r = 108 - i * 11;
          const c = 2 * Math.PI * r;
          const frac = Math.max(d.value / total, 0.012);
          const color = PALETTE[i % PALETTE.length];
          const dim = active && active !== d.code;
          return (
            <g key={d.code} style={{ opacity: dim ? 0.22 : 1, transition: "opacity .3s" }}>
              <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={5} />
              <motion.circle
                cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
                strokeDasharray={c} transform={`rotate(-90 ${cx} ${cx})`}
                initial={{ strokeDashoffset: c }} whileInView={{ strokeDashoffset: c * (1 - frac) }} viewport={{ once: true }}
                transition={{ duration: 1.6, delay: 0.15 + i * 0.09, ease: EASE }}
                style={{ filter: `drop-shadow(0 0 5px ${color}aa)`, cursor: "pointer" }}
                onMouseEnter={() => setActive(d.code)} onMouseLeave={() => setActive(null)} onClick={() => onPick(d.code)}
              />
            </g>
          );
        })}
        <text x={cx} y={cx - 2} textAnchor="middle" className="fill-[var(--text)] font-mono" fontSize="22" fontWeight="600">{rows.length}</text>
        <text x={cx} y={cx + 14} textAnchor="middle" className="fill-[var(--faint)] font-mono" fontSize="7" letterSpacing="2">MARKETS</text>
      </svg>
      <ul className="w-full space-y-0.5">
        {rows.map((d, i) => (
          <li key={d.code}>
            <button
              onMouseEnter={() => setActive(d.code)} onMouseLeave={() => setActive(null)} onClick={() => onPick(d.code)}
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition ${active === d.code ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length], boxShadow: `0 0 8px ${PALETTE[i % PALETTE.length]}` }} />
              <span className="flex-1 text-left">{d.name}</span>
              <span className="font-mono text-xs tabular text-muted">{fmt(d.value)}</span>
              <span className="w-10 text-right font-mono text-[10px] tabular text-faint">{((d.value / total) * 100).toFixed(d.value / total < 0.01 ? 1 : 0)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NicheBars({ data, onPick }: { data: { name: string; value: number }[]; onPick: (n: string) => void }) {
  const max = Math.max(...data.map((d) => d.value));
  return (
    <div className="px-3 pb-4 pt-3">
      {data.map((n, i) => {
        const color = PALETTE[(i + 1) % PALETTE.length];
        return (
          <button key={n.name} onClick={() => onPick(n.name)} className="group grid w-full cursor-pointer grid-cols-[118px_1fr_52px] items-center gap-3 rounded-lg px-2 py-[7px] transition hover:bg-white/[0.04]">
            <span className="truncate text-left text-[12px] text-muted transition group-hover:text-text">{n.name}</span>
            <span className="relative h-[7px] overflow-hidden rounded-full bg-white/[0.05]">
              <motion.span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ background: `linear-gradient(90deg, ${color}22, ${color})`, boxShadow: `0 0 14px ${color}55` }}
                initial={{ width: 0 }} whileInView={{ width: `${(n.value / max) * 100}%` }} viewport={{ once: true }}
                transition={{ duration: 1.2, delay: 0.1 + i * 0.05, ease: EASE }}
              />
            </span>
            <span className="text-right font-mono text-xs tabular text-text/90">{fmt(n.value)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ScoreBands({ data, onPick }: { data: { start: number; label: string; value: number }[]; onPick: (s: number) => void }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="relative px-5 pb-9 pt-10">
      <div className="relative flex h-[200px] items-end gap-2">
        {data.map((b, i) => {
          const color = SCORE_COLOR[scoreTone(b.start)];
          const hot = b.start >= 60;
          return (
            <button key={b.label} onClick={() => onPick(b.start)} className="group relative flex h-full flex-1 cursor-pointer flex-col justify-end">
              {hot && <span className="absolute inset-0 rounded-lg border-t border-dashed border-accent/40 bg-accent/[0.035]" />}
              {b.start === 60 && <span className="hud absolute -top-6 left-0 whitespace-nowrap !text-accent-text">Hot zone →</span>}
              <span className="relative mb-1.5 text-center font-mono text-[10px] tabular text-muted transition group-hover:text-text">{fmt(b.value)}</span>
              <motion.span
                className="relative w-full rounded-t-md transition group-hover:brightness-125"
                style={{ background: `linear-gradient(180deg, ${color}, ${color}1a)`, boxShadow: b.start >= 40 ? `0 0 22px -4px ${color}` : undefined }}
                initial={{ height: 0 }} whileInView={{ height: `${Math.max(1.5, (b.value / max) * 82)}%` }} viewport={{ once: true }}
                transition={{ duration: 1.1, delay: 0.1 + i * 0.06, ease: EASE }}
              />
              <span className="absolute -bottom-6 left-0 right-0 text-center font-mono text-[10px] text-faint">{b.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const EMAIL_COLOR: Record<string, string> = { valid: "#3ef08a", risky: "#ffb547", invalid: "#ff5c7a", none: "#5f6878" };
const EMAIL_HINT: Record<string, string> = {
  valid: "Mailbox confirmed. Safe to email.",
  risky: "Server hides its mailboxes. May bounce.",
  invalid: "Bounces. Use phone or WhatsApp.",
  none: "No address. Phone, WhatsApp or social.",
};

function EmailGauge({ data, total, onPick }: { data: { key: EmailStatus; value: number }[]; total: number; onPick: (k: string) => void }) {
  const [active, setActive] = useState<string | null>(null);
  const R = 76, C = 2 * Math.PI * R, GAP = 5;
  let acc = 0;
  const segs = data.map((s) => {
    const len = (s.value / total) * C;
    const seg = { ...s, len: Math.max(0, len - GAP), offset: acc };
    acc += len;
    return seg;
  });
  const valid = data.find((x) => x.key === "valid")?.value ?? 0;
  return (
    <div className="flex flex-col items-center gap-3 px-5 pb-5 pt-4 sm:flex-row">
      <div className="relative h-[190px] w-[190px] shrink-0">
        <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
          <circle cx="100" cy="100" r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="13" />
          {segs.map((s, i) => (
            <motion.circle
              key={s.key} cx="100" cy="100" r={R} fill="none" stroke={EMAIL_COLOR[s.key]} strokeWidth="13"
              strokeDashoffset={-s.offset}
              initial={{ strokeDasharray: `0 ${C}` }} whileInView={{ strokeDasharray: `${s.len} ${C}` }} viewport={{ once: true }}
              transition={{ duration: 1.1, delay: 0.2 + i * 0.18, ease: EASE }}
              style={{ filter: `drop-shadow(0 0 6px ${EMAIL_COLOR[s.key]}77)`, opacity: active && active !== s.key ? 0.25 : 1, transition: "opacity .3s", cursor: "pointer" }}
              onMouseEnter={() => setActive(s.key)} onMouseLeave={() => setActive(null)} onClick={() => onPick(s.key)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="font-mono text-3xl font-semibold text-good tabular">{Math.round((valid / total) * 100)}%</div>
            <div className="hud mt-1 !text-[8px]">safe to email</div>
          </div>
        </div>
      </div>
      <ul className="w-full space-y-1">
        {data.map((e) => (
          <li key={e.key}>
            <button
              onMouseEnter={() => setActive(e.key)} onMouseLeave={() => setActive(null)} onClick={() => onPick(e.key)}
              className={`flex w-full cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 text-left transition ${active === e.key ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"}`}
            >
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: EMAIL_COLOR[e.key], boxShadow: `0 0 8px ${EMAIL_COLOR[e.key]}` }} />
              <span className="flex-1">
                <span className="text-[13px] font-medium">{EMAIL_LABEL[e.key]}</span>
                <span className="block text-[11px] text-faint">{EMAIL_HINT[e.key]}</span>
              </span>
              <span className="font-mono text-sm tabular">{fmt(e.value)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Timeline({ days }: { days: { day: string; value: number }[] }) {
  const max = Math.max(...days.map((d) => d.value), 1);
  const every = Math.ceil(days.length / 7);
  return (
    <div className="px-5 pb-9 pt-8">
      <div className="relative flex h-[190px] items-end gap-[4px]">
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <span key={g} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-white/[0.05]" style={{ bottom: `${g * 88}%` }} />
        ))}
        {days.map((d, i) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end">
            <motion.div
              className="w-full rounded-t-[4px] transition group-hover:brightness-150"
              style={{ background: "linear-gradient(180deg, #3ee6ff, rgba(62,230,255,0.08))", boxShadow: "0 0 16px -5px #3ee6ff" }}
              initial={{ height: 0 }} whileInView={{ height: `${Math.max(2, (d.value / max) * 88)}%` }} viewport={{ once: true }}
              transition={{ duration: 1, delay: 0.05 + i * 0.03, ease: EASE }}
            />
            <div className="glass pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] opacity-0 transition group-hover:opacity-100">
              <span className="font-mono text-cyan">{fmt(d.value)}</span> sent · {formatDate(d.day)}
            </div>
            {i % every === 0 && (
              <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[9.5px] text-faint">
                {formatDate(d.day).replace(/ \d{4}$/, "")}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceList({ sources, total }: { sources: [string, number][]; total: number }) {
  const live = new Set(sources.map(([s]) => s));
  const offline = SOURCE_GROUPS.flatMap((g) => g.items.map((i) => i.name)).filter((s) => !live.has(s));
  return (
    <div className="px-5 pb-5 pt-3">
      <ul className="space-y-2.5">
        {sources.map(([name, value], i) => (
          <li key={name}>
            <div className="flex items-center justify-between text-[12px]">
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" />
                {name}
              </span>
              <span className="font-mono tabular text-muted">{fmt(value)}</span>
            </div>
            <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-white/[0.05]">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-accent/30 to-accent shadow-[0_0_10px_var(--accent)]"
                initial={{ width: 0 }} whileInView={{ width: `${(value / total) * 100}%` }} viewport={{ once: true }}
                transition={{ duration: 1.1, delay: 0.1 + i * 0.06, ease: EASE }}
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-5 border-t border-line pt-4">
        <Hud>Offline · {offline.length} sources</Hud>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {offline.map((s, i) => (
            <motion.span
              key={s}
              initial={{ opacity: 0, y: 6 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.03 }}
              className="rounded-full border border-dashed border-line-strong px-2 py-[3px] text-[10.5px] text-faint"
            >
              {s}
            </motion.span>
          ))}
        </div>
      </div>
    </div>
  );
}

function FileLog({ datasets }: { datasets: { file: string; rows: number }[] }) {
  return (
    <div className="scanline relative overflow-hidden px-5 pb-5 pt-4">
      <div className="grid grid-cols-1 gap-x-10 gap-y-1 font-mono text-[12px] sm:grid-cols-2 lg:grid-cols-3">
        {datasets.map((f, i) => (
          <motion.div
            key={f.file}
            initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.035, duration: 0.4 }}
            className="flex items-center gap-2 py-1"
          >
            <span className="text-accent-text">›</span>
            <span className="text-muted">{f.file}</span>
            <span className="h-px flex-1 border-t border-dotted border-white/10" />
            <span className="tabular text-text">{fmt(f.rows)}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
