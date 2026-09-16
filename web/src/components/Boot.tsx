import { motion } from "motion/react";
import { fmt } from "../lib/data";
import type { LeadsFile } from "../lib/types";
import { EASE } from "./ui";

/** Short start-up sequence while the lead file loads. Every figure shown is read from the file. */
export function Boot({ file }: { file: LeadsFile | null }) {
  const located = file ? file.leads.filter((l) => l.lat != null).length : 0;
  const lines: [string, string][] = [
    ["Connecting to engine", file ? "online" : "…"],
    ["Exclusion list", file ? `${fmt(file.known.businesses)} past businesses` : "…"],
    ["New leads", file ? fmt(file.leads.length) : "…"],
    ["Plotting coordinates", file ? fmt(located) : "…"],
  ];

  return (
    <motion.div
      key="boot"
      className="fixed inset-0 z-[3000] grid place-items-center bg-bg"
      exit={{ opacity: 0, scale: 1.06, filter: "blur(14px)" }}
      transition={{ duration: 0.7, ease: EASE }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="grid-floor opacity-60" />
      </div>

      <div className="relative flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: EASE }}
          className="relative h-52 w-52"
        >
          <svg viewBox="0 0 200 200" className="absolute inset-0">
            {[92, 70, 48, 26].map((r, i) => (
              <motion.circle
                key={r} cx="100" cy="100" r={r} fill="none" stroke="rgba(200,245,66,0.28)" strokeWidth="1"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: i * 0.12, ease: EASE }}
              />
            ))}
            <line x1="100" y1="6" x2="100" y2="194" stroke="rgba(255,255,255,0.08)" />
            <line x1="6" y1="100" x2="194" y2="100" stroke="rgba(255,255,255,0.08)" />
          </svg>
          <div
            className="radar-sweep absolute inset-[8px] rounded-full"
            style={{ background: "conic-gradient(from 0deg, rgba(200,245,66,0.5), rgba(200,245,66,0) 70deg, transparent 360deg)" }}
          />
          {[[128, 58], [62, 80], [140, 132], [86, 146], [112, 96]].map(([x, y], i) => (
            <motion.span
              key={i}
              className="absolute h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]"
              style={{ left: x * 1.04, top: y * 1.04 }}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: [0, 1, 0.5], scale: [0, 1.6, 1] }}
              transition={{ delay: 0.5 + i * 0.22, duration: 0.8 }}
            />
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, letterSpacing: "0.6em" }}
          animate={{ opacity: 1, letterSpacing: "0.32em" }}
          transition={{ duration: 1.1, delay: 0.2, ease: EASE }}
          className="mt-8 font-mono text-sm font-semibold uppercase text-text"
        >
          Lead Radar
        </motion.div>

        <div className="mt-6 w-72 space-y-2">
          {lines.map(([label, value], i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.45 + i * 0.22, duration: 0.5, ease: EASE }}
              className="flex items-center justify-between font-mono text-[11px]"
            >
              <span className="text-faint">{label}</span>
              <span className="flex items-center gap-2">
                <span className="text-muted tabular">{value}</span>
                <span className={file ? "text-accent-text" : "text-faint"}>{file ? "OK" : "··"}</span>
              </span>
            </motion.div>
          ))}
        </div>

        <div className="mt-6 h-px w-72 overflow-hidden bg-white/10">
          <motion.div
            className="h-full bg-accent shadow-[0_0_12px_var(--accent)]"
            initial={{ width: "0%" }}
            animate={{ width: file ? "100%" : "70%" }}
            transition={{ duration: file ? 1.4 : 2.4, ease: EASE }}
          />
        </div>
      </div>
    </motion.div>
  );
}
