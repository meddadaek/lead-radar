import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { geoEquirectangular, geoPath } from "d3-geo";
import { AnimatePresence, motion } from "motion/react";
import { Component, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import * as THREE from "three";
import { feature } from "topojson-client";
import landTopo from "world-atlas/land-110m.json";
import { COUNTRIES, scoreTone } from "../lib/data";
import type { Lead } from "../lib/types";
import { SCORE_COLOR } from "./ui";

const D2R = Math.PI / 180;
export const HOME = { lat: 36.7538, lon: 3.0588, name: "Algiers" };

/** Countries whose leads carry no coordinates still get an arc. */
const FALLBACK: Record<string, [number, number]> = { AE: [25.2, 55.27], LU: [49.61, 6.13], CA: [49.9, -97.1] };

export function toVec3(lat: number, lon: number, r = 1) {
  const phi = (90 - lat) * D2R;
  const theta = (lon + 180) * D2R;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

/* ------------------------------------------------------------------ land dots
   Paint the real coastline (Natural Earth 110m) onto a small equirectangular canvas,
   then keep the points of an even Fibonacci sphere that land on painted pixels. */
function buildLand(count: number) {
  const W = 1024, H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const topo = landTopo as any;
  const land = feature(topo, topo.objects.land) as any;
  const path = geoPath(geoEquirectangular().fitSize([W, H], { type: "Sphere" } as any), ctx);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  path(land);
  ctx.fill();
  const px = ctx.getImageData(0, 0, W, H).data;

  const pos: number[] = [];
  const seeds: number[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = golden * i;
    const x = Math.cos(th) * rad;
    const z = Math.sin(th) * rad;
    const lat = Math.asin(y) / D2R;
    let lon = Math.atan2(z, -x) / D2R - 180;
    if (lon < -180) lon += 360;
    const ix = Math.min(W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * W)));
    const iy = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
    if (px[(iy * W + ix) * 4 + 3] > 120) {
      pos.push(x, y, z);
      seeds.push((lon + 180) / 360);
    }
  }
  return { positions: new Float32Array(pos), seeds: new Float32Array(seeds) };
}

/* ------------------------------------------------------------------ shaders */

const facingVert = /* glsl */ `
  uniform float uReveal;
  uniform float uPixel;
  uniform float uTime;
  attribute float aSeed;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aHot;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normalize(position));
    float facing = clamp(dot(n, vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
    float pulse = aHot * (0.5 + 0.5 * sin(uTime * 3.2 + aSeed * 60.0));
    vAlpha = smoothstep(0.0, 0.45, facing) * smoothstep(aSeed, aSeed + 0.06, uReveal);
    vColor = aColor;
    gl_PointSize = uPixel * aSize * (0.75 + 0.35 * facing) * (1.0 + pulse * 0.7);
    gl_Position = projectionMatrix * mv;
  }
`;

const landFrag = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.1, d) * vAlpha;
    gl_FragColor = vec4(vColor, a * 0.95);
  }
`;

const leadFrag = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = smoothstep(0.2, 0.0, d);
    float halo = smoothstep(0.5, 0.0, d) * 0.6;
    gl_FragColor = vec4(vColor * (core * 1.6 + halo), (core + halo) * vAlpha);
  }
`;

const fresnelVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const coreFrag = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uRim;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = pow(1.0 - max(dot(vN, vV), 0.0), 3.0);
    gl_FragColor = vec4(uBase + uRim * f * 0.85, 1.0);
  }
`;

const atmoFrag = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float i = pow(max(0.0, 0.62 + dot(vN, vV)), 3.2);
    gl_FragColor = vec4(uColor, 1.0) * i * 0.9;
  }
`;

const arcVert = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const arcFrag = /* glsl */ `
  uniform float uTime;
  uniform float uOffset;
  uniform float uReveal;
  uniform vec3 uColor;
  varying float vT;
  void main() {
    float head = fract(uTime * 0.28 + uOffset);
    float d = head - vT;
    float trail = smoothstep(0.32, 0.0, d) * step(0.0, d);
    float drawn = step(vT, uReveal);
    gl_FragColor = vec4(uColor, (0.12 + trail * 0.95) * drawn);
  }
`;

/* ------------------------------------------------------------------ scene parts */

function Earth({ reveal }: { reveal: MutableRefObject<number> }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const { geometry, material } = useMemo(() => {
    const land = buildLand(26000);
    const g = new THREE.BufferGeometry();
    const n = land.seeds.length;
    const colors = new Float32Array(n * 3);
    const c1 = new THREE.Color("#6f93c6");
    const c2 = new THREE.Color("#c3dbf7");
    for (let i = 0; i < n; i++) {
      const c = c1.clone().lerp(c2, Math.random() * 0.7);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("position", new THREE.BufferAttribute(land.positions, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(land.seeds, 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n).fill(3.1), 1));
    g.setAttribute("aHot", new THREE.BufferAttribute(new Float32Array(n), 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uReveal: { value: 0 }, uPixel: { value: dpr }, uTime: { value: 0 } },
      vertexShader: facingVert, fragmentShader: landFrag, transparent: true, depthWrite: false,
    });
    return { geometry: g, material: m };
  }, [dpr]);

  const core = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uBase: { value: new THREE.Color("#04060e") }, uRim: { value: new THREE.Color("#1a8fb0") } },
    vertexShader: fresnelVert, fragmentShader: coreFrag,
  }), []);
  const atmo = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color("#3ee6ff") } },
    vertexShader: fresnelVert, fragmentShader: atmoFrag,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }), []);

  useFrame(() => {
    material.uniforms.uReveal.value = reveal.current * 1.1;
  });

  return (
    <>
      {/* Solid core: hides the far side and swallows pointer events behind it */}
      <mesh material={core} onPointerMove={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <sphereGeometry args={[0.992, 96, 96]} />
      </mesh>
      <points geometry={geometry} material={material} />
      <mesh material={atmo} scale={1.2}>
        <sphereGeometry args={[1, 64, 64]} />
      </mesh>
    </>
  );
}

function LeadPoints({
  located, reveal, onHover, onPick,
}: {
  located: Lead[];
  reveal: MutableRefObject<number>;
  onHover: (h: { lead: Lead; x: number; y: number } | null) => void;
  onPick: (id: string) => void;
}) {
  const dpr = useThree((s) => s.viewport.dpr);
  const { geometry, material } = useMemo(() => {
    const n = located.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const hot = new Float32Array(n);
    const seed = new Float32Array(n);
    const c = new THREE.Color();
    located.forEach((l, i) => {
      const v = toVec3(l.lat!, l.lon!, 1.008);
      pos.set([v.x, v.y, v.z], i * 3);
      const tone = scoreTone(l.score);
      c.set(SCORE_COLOR[tone]);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = tone === "accent" ? 7.5 : tone === "good" ? 5.2 : tone === "warn" ? 4 : 3;
      hot[i] = l.score >= 60 ? 1 : 0;
      seed[i] = 0.25 + 0.75 * ((l.lon! + 180) / 360);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aHot", new THREE.BufferAttribute(hot, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uReveal: { value: 0 }, uPixel: { value: dpr }, uTime: { value: 0 } },
      vertexShader: facingVert, fragmentShader: leadFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    return { geometry: g, material: m };
  }, [located, dpr]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uReveal.value = reveal.current;
  });

  const at = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.index == null ? null : located[e.index]);

  return (
    <points
      geometry={geometry}
      material={material}
      onPointerMove={(e) => {
        e.stopPropagation();
        const lead = at(e);
        if (lead) onHover({ lead, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        const lead = at(e);
        if (lead) onPick(lead.id);
      }}
    />
  );
}

function Arcs({ leads, reveal }: { leads: Lead[]; reveal: MutableRefObject<number> }) {
  const lines = useMemo(() => {
    const sums = new Map<string, THREE.Vector3>();
    const seen = new Set<string>();
    leads.forEach((l) => {
      seen.add(l.country);
      if (l.lat == null || l.lon == null) return;
      const v = sums.get(l.country) ?? new THREE.Vector3();
      sums.set(l.country, v.add(toVec3(l.lat, l.lon)));
    });
    const home = toVec3(HOME.lat, HOME.lon, 1.006);
    const palette = ["#c8f542", "#3ee6ff", "#9b8cff"];
    return [...seen]
      .filter((cc) => cc !== "DZ" && (sums.has(cc) || FALLBACK[cc]))
      .map((cc, i) => {
        const target = sums.has(cc) ? sums.get(cc)!.clone().normalize().multiplyScalar(1.006) : toVec3(FALLBACK[cc][0], FALLBACK[cc][1], 1.006);
        const mid = home.clone().add(target).multiplyScalar(0.5);
        mid.normalize().multiplyScalar(1 + home.distanceTo(target) * 0.42);
        const pts = new THREE.QuadraticBezierCurve3(home, mid, target).getPoints(96);
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        g.setAttribute("aT", new THREE.BufferAttribute(new Float32Array(pts.map((_, k) => k / (pts.length - 1))), 1));
        const m = new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 }, uOffset: { value: i * 0.19 }, uReveal: { value: 0 }, uColor: { value: new THREE.Color(palette[i % 3]) } },
          vertexShader: arcVert, fragmentShader: arcFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        return { cc, line: new THREE.Line(g, m), material: m, target };
      });
  }, [leads]);

  useFrame(({ clock }) => {
    const r = Math.max(0, Math.min(1, (reveal.current - 0.7) * 1.6));
    lines.forEach((l) => {
      l.material.uniforms.uTime.value = clock.elapsedTime;
      l.material.uniforms.uReveal.value = r;
    });
  });

  return (
    <>
      {lines.map((l) => (
        <group key={l.cc}>
          <primitive object={l.line} />
          <mesh position={l.target}>
            <sphereGeometry args={[0.009, 12, 12]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Beacon() {
  const r1 = useRef<THREE.Mesh>(null);
  const r2 = useRef<THREE.Mesh>(null);
  const { pos, quat } = useMemo(() => {
    const p = toVec3(HOME.lat, HOME.lon, 1.01);
    return { pos: p, quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.clone().normalize()) };
  }, []);
  useFrame(({ clock }) => {
    [r1, r2].forEach((ref, i) => {
      const m = ref.current;
      if (!m) return;
      const p = (clock.elapsedTime * 0.7 + i * 0.5) % 1;
      m.scale.setScalar(0.5 + p * 2.4);
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.9;
    });
  });
  return (
    <group position={pos} quaternion={quat}>
      <mesh>
        <circleGeometry args={[0.011, 24]} />
        <meshBasicMaterial color="#c8f542" />
      </mesh>
      {[r1, r2].map((ref, i) => (
        <mesh key={i} ref={ref}>
          <ringGeometry args={[0.018, 0.023, 48]} />
          <meshBasicMaterial color="#c8f542" transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function Scene({
  leads, located, hovering, onHover, onPick,
}: {
  leads: Lead[]; located: Lead[]; hovering: boolean;
  onHover: (h: { lead: Lead; x: number; y: number } | null) => void; onPick: (id: string) => void;
}) {
  const reveal = useRef(0);
  const intro = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    reveal.current = Math.min(1.5, reveal.current + dt * 0.5);
    const g = intro.current;
    if (g) {
      const k = 1 - Math.pow(1 - Math.min(1, reveal.current / 1.2), 3);
      g.scale.setScalar(0.82 + 0.18 * k);
      g.rotation.y = (1 - k) * 0.9;
    }
  });
  return (
    <>
      <group ref={intro}>
        {/* start facing Algeria, Europe and the Atlantic */}
        <group rotation={[0.42, -75 * D2R, 0]}>
          <Earth reveal={reveal} />
          <LeadPoints located={located} reveal={reveal} onHover={onHover} onPick={onPick} />
          <Arcs leads={leads} reveal={reveal} />
          <Beacon />
        </group>
      </group>
      <OrbitControls
        enableZoom={false} enablePan={false} enableDamping dampingFactor={0.07}
        rotateSpeed={0.45} autoRotate={!hovering} autoRotateSpeed={0.5}
        minPolarAngle={0.55} maxPolarAngle={Math.PI - 0.55}
      />
    </>
  );
}

class GlobeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="grid h-full place-items-center text-xs text-faint">3D globe unavailable: WebGL is turned off in this browser.</div>
    ) : (
      this.props.children
    );
  }
}

/** `className` must position the wrapper (absolute/relative) and give it a size; the canvas fills it. */
export function Globe({ leads, onOpen, className = "relative h-full w-full" }: { leads: Lead[]; onOpen: (id: string) => void; className?: string }) {
  const [hover, setHover] = useState<{ lead: Lead; x: number; y: number } | null>(null);
  // lowest scores first so hot leads draw on top
  const located = useMemo(() => leads.filter((l) => l.lat != null && l.lon != null).sort((a, b) => a.score - b.score), [leads]);

  return (
    <div className={className}>
      <GlobeBoundary>
        <Canvas
          dpr={[1, 1.75]}
          camera={{ position: [0, 0, 3.3], fov: 40 }}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          onCreated={({ raycaster }) => {
            raycaster.params.Points = { threshold: 0.018 };
          }}
          style={{ cursor: hover ? "pointer" : "grab" }}
        >
          <Scene leads={leads} located={located} hovering={!!hover} onHover={setHover} onPick={onOpen} />
        </Canvas>
      </GlobeBoundary>

      <AnimatePresence>
        {hover && (
          <motion.div
            key="tip"
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="glass pointer-events-none absolute z-20 w-60 rounded-xl px-3 py-2.5"
            style={{ left: hover.x + 16, top: hover.y + 16 }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="hud !text-[9px]">{COUNTRIES[hover.lead.country] ?? hover.lead.country} · {hover.lead.niche}</span>
              <span className="font-mono text-xs font-semibold" style={{ color: SCORE_COLOR[scoreTone(hover.lead.score)] }}>{hover.lead.score}</span>
            </div>
            <div className="mt-1 truncate text-[13px] font-medium">{hover.lead.name}</div>
            <div className="truncate text-[11px] text-faint">{hover.lead.city || hover.lead.email || "—"} · click to open</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
