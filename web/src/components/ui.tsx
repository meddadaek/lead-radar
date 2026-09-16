import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { fmt, scoreTone, type Tone } from "../lib/data";

export const EASE = [0.16, 1, 0.3, 1] as const;

export const TONE_COLOR: Record<Tone, string> = {
  good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)", info: "var(--cyan)", accent: "var(--accent)", neutral: "var(--faint)",
};

/** Score bands use their own ramp so the globe, meters and charts all agree. */
export const SCORE_COLOR: Record<Tone, string> = {
  accent: "#c8f542", good: "#3ee6ff", warn: "#9b8cff", neutral: "#4b5566", info: "#3ee6ff", bad: "#ff5c7a",
};

const TONE: Record<Tone, string> = {
  good: "text-good border-good/30 bg-good/10",
  warn: "text-warn border-warn/30 bg-warn/10",
  bad: "text-bad border-bad/30 bg-bad/10",
  info: "text-cyan border-cyan/30 bg-cyan/10",
  accent: "text-accent-text border-accent/40 bg-accent/10 shadow-[0_0_18px_-6px_var(--accent)]",
  neutral: "text-muted border-line-strong bg-white/[0.03]",
};

export function Pill({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-[3px] text-[10.5px] font-medium leading-none tracking-wide ${TONE[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Hud({ children, accent = false, className = "" }: { children: ReactNode; accent?: boolean; className?: string }) {
  return (
    <span className={`hud inline-flex items-center gap-2 ${className}`}>
      {accent && <span className="h-1 w-1 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" />}
      {children}
    </span>
  );
}

export function Brackets() {
  return (
    <>
      <span className="br tl" />
      <span className="br tr" />
      <span className="br bl" />
      <span className="br brr" />
    </>
  );
}

export function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const onMouseMove = (e: MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return { ref, onMouseMove };
}

export function GlowCard({
  kicker, title, hint, right, children, className = "", delay = 0,
}: { kicker?: string; title?: string; hint?: string; right?: ReactNode; children: ReactNode; className?: string; delay?: number }) {
  const { ref, onMouseMove } = useSpotlight<HTMLElement>();
  const reduce = useReducedMotion();
  return (
    <motion.section
      ref={ref}
      onMouseMove={onMouseMove}
      initial={reduce ? false : { opacity: 0, y: 28, scale: 0.985 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.8, delay, ease: EASE }}
      className={`glass spot rounded-[22px] ${className}`}
    >
      {(title || right) && (
        <header className="flex items-start justify-between gap-4 px-5 pt-5">
          <div className="min-w-0">
            {kicker && <Hud accent>{kicker}</Hud>}
            {title && <h2 className="mt-1.5 text-[15px] font-semibold tracking-tight text-text">{title}</h2>}
            {hint && <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted">{hint}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </motion.section>
  );
}

export function CountUp({ value, className = "", duration = 1.6 }: { value: number; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    if (reduce) {
      el.textContent = fmt(value);
      return;
    }
    const c = animate(0, value, {
      duration,
      ease: EASE,
      onUpdate: (v) => {
        el.textContent = fmt(Math.round(v));
      },
    });
    return () => c.stop();
  }, [inView, value, reduce, duration]);
  return <span ref={ref} className={`tabular ${className}`}>0</span>;
}

export function ScoreMeter({ score }: { score: number }) {
  const lit = Math.round(score / 10);
  const color = SCORE_COLOR[scoreTone(score)];
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-4 items-end gap-[2.5px]">
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full"
            style={{
              height: `${7 + i * 0.9}px`,
              background: i < lit ? color : "rgba(255,255,255,0.09)",
              boxShadow: i < lit && score >= 40 ? `0 0 7px ${color}` : undefined,
            }}
          />
        ))}
      </div>
      <span className="font-mono text-xs tabular" style={{ color: score >= 20 ? color : "var(--muted)" }}>{score}</span>
    </div>
  );
}

export function ScoreRing({ score, size = 112 }: { score: number; size?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const reduce = useReducedMotion();
  const cx = size / 2;
  const r = size / 2 - 16;
  const c = 2 * Math.PI * r;
  const color = SCORE_COLOR[scoreTone(score)];
  const ticks = 60;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3ee6ff" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        {Array.from({ length: ticks }, (_, i) => {
          const a = (i / ticks) * Math.PI * 2 - Math.PI / 2;
          const on = i / ticks < score / 100;
          const r1 = r + 8;
          const r2 = r + (i % 5 === 0 ? 13 : 11);
          return (
            <motion.line
              key={i}
              x1={cx + Math.cos(a) * r1} y1={cx + Math.sin(a) * r1} x2={cx + Math.cos(a) * r2} y2={cx + Math.sin(a) * r2}
              stroke={on ? color : "rgba(255,255,255,0.12)"} strokeWidth={1.2} strokeLinecap="round"
              initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 + i * 0.008 }}
            />
          );
        })}
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={6} />
        <motion.circle
          cx={cx} cy={cx} r={r} fill="none" stroke={`url(#g${uid})`} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={c} transform={`rotate(-90 ${cx} ${cx})`}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          initial={{ strokeDashoffset: reduce ? c * (1 - score / 100) : c }}
          animate={{ strokeDashoffset: c * (1 - score / 100) }}
          transition={{ duration: 1.2, ease: EASE }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-mono text-[26px] font-semibold leading-none tabular" style={{ color }}>{score}</div>
          <div className="hud mt-1 !text-[8px]">/ 100</div>
        </div>
      </div>
    </div>
  );
}

export function Select({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const active = value !== "";
  return (
    <label className={`relative flex h-9 items-center rounded-full border text-xs transition-all duration-300 ${active ? "border-accent/50 bg-accent/10 shadow-[0_0_24px_-10px_var(--accent)]" : "border-line bg-white/[0.03] hover:border-line-strong hover:bg-white/[0.05]"}`}>
      <span className={`pointer-events-none pl-3.5 font-mono text-[10px] uppercase tracking-[0.14em] ${active ? "text-accent-text" : "text-faint"}`}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full cursor-pointer appearance-none bg-transparent pl-2 pr-7 font-medium text-text outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-panel-solid text-text">
            {o.label}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2.5 h-3 w-3 text-faint" viewBox="0 0 12 12" fill="none">
        <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </label>
  );
}

export function Button({
  children, onClick, variant = "ghost", className = "", disabled, title, type = "button",
}: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "danger"; className?: string;
  disabled?: boolean; title?: string; type?: "button" | "submit";
}) {
  const styles = {
    primary: "shimmer overflow-hidden border-transparent bg-accent font-semibold text-accent-ink shadow-[0_0_32px_-8px_var(--accent)] hover:shadow-[0_0_44px_-6px_var(--accent)]",
    ghost: "border-line bg-white/[0.035] text-text hover:border-line-strong hover:bg-white/[0.07]",
    danger: "border-bad/30 bg-bad/10 text-bad hover:bg-bad/20",
  }[variant];
  return (
    <motion.button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      className={`relative inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-4 text-xs transition-[box-shadow,background-color,border-color] duration-300 disabled:cursor-not-allowed disabled:opacity-35 ${styles} ${className}`}
    >
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </motion.button>
  );
}

export function CountryCode({ code }: { code: string }) {
  return (
    <span className="inline-flex h-5 min-w-8 items-center justify-center rounded-md border border-line-strong bg-white/[0.04] px-1.5 font-mono text-[10px] font-semibold tracking-wider text-muted">
      {code || "—"}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 items-center rounded-md border border-line-strong bg-white/[0.04] px-1.5 font-mono text-[10px] text-muted">
      {children}
    </kbd>
  );
}
