/**
 * Overview of satellite fire detections (INPE) drawn on a canvas — no map
 * tiles, no third-party geometry. Orientation comes from a lat/lng graticule
 * and the 27 state capitals; state labels sit at the mean position of the
 * detections themselves. Cell glow ∝ sqrt(count).
 */
import { useEffect, useRef, useState } from "react";

export interface GridCell { lat: number; lng: number; n: number }
export interface StateAgg { state: string; n: number; lat: number; lng: number }

const BBOX = { minLng: -74.5, maxLng: -33.5, minLat: -34.5, maxLat: 6 };
const COS = Math.cos((-14 * Math.PI) / 180); // equirectangular, corrected at Brazil's mid-latitude

const CAPITALS: [string, number, number][] = [
  ["Rio Branco", -9.97, -67.81], ["Maceió", -9.67, -35.74], ["Macapá", 0.03, -51.07], ["Manaus", -3.12, -60.02],
  ["Salvador", -12.97, -38.5], ["Fortaleza", -3.73, -38.52], ["Brasília", -15.79, -47.88], ["Vitória", -20.32, -40.34],
  ["Goiânia", -16.69, -49.26], ["São Luís", -2.53, -44.3], ["Cuiabá", -15.6, -56.1], ["Campo Grande", -20.47, -54.62],
  ["Belo Horizonte", -19.92, -43.94], ["Belém", -1.46, -48.49], ["João Pessoa", -7.12, -34.86], ["Curitiba", -25.43, -49.27],
  ["Recife", -8.05, -34.88], ["Teresina", -5.09, -42.8], ["Rio de Janeiro", -22.91, -43.17], ["Natal", -5.79, -35.21],
  ["Porto Alegre", -30.03, -51.23], ["Porto Velho", -8.76, -63.9], ["Boa Vista", 2.82, -60.67], ["Florianópolis", -27.59, -48.55],
  ["São Paulo", -23.55, -46.63], ["Aracaju", -10.91, -37.07], ["Palmas", -10.18, -48.33],
];

export function HotspotConstellation({ cells, states, className = "" }: { cells: GridCell[]; states: StateAgg[]; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 580 });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.max(280, Math.floor(e.contentRect.width));
      const geoW = (BBOX.maxLng - BBOX.minLng) * COS;
      const geoH = BBOX.maxLat - BBOX.minLat;
      setSize({ w, h: Math.round((w * geoH) / geoW) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const k = size.w / ((BBOX.maxLng - BBOX.minLng) * COS);
    const px = (lng: number) => (lng - BBOX.minLng) * COS * k;
    const py = (lat: number) => (BBOX.maxLat - lat) * k;
    const maxN = Math.max(1, ...cells.map((c) => c.n));
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const sorted = [...cells].sort((a, b) => a.n - b.n);
    let frame = 0;
    let raf = 0;
    const total = reduce ? 1 : 70;

    const draw = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      // graticule
      ctx.strokeStyle = "rgba(167, 243, 208, 0.10)";
      ctx.lineWidth = 1;
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillStyle = "rgba(167, 243, 208, 0.35)";
      for (let lat = -30; lat <= 0; lat += 10) {
        ctx.beginPath(); ctx.moveTo(0, py(lat)); ctx.lineTo(size.w, py(lat)); ctx.stroke();
        ctx.fillText(`${Math.abs(lat)}°${lat < 0 ? "S" : ""}`, 4, py(lat) - 3);
      }
      for (let lng = -70; lng <= -40; lng += 10) {
        ctx.beginPath(); ctx.moveTo(px(lng), 0); ctx.lineTo(px(lng), size.h); ctx.stroke();
      }
      // capitals (reference only)
      for (const [name, lat, lng] of CAPITALS) {
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.beginPath(); ctx.arc(px(lng), py(lat), 1.6, 0, Math.PI * 2); ctx.fill();
        if (size.w >= 520 && (name === "Brasília" || name === "Manaus" || name === "São Paulo" || name === "Porto Alegre" || name === "Recife")) {
          ctx.fillStyle = "rgba(255,255,255,0.45)";
          const tw = ctx.measureText(name).width;
          const lx = px(lng) + 4 + tw > size.w - 2 ? px(lng) - 4 - tw : px(lng) + 4; // keep inside the canvas
          ctx.fillText(name, lx, py(lat) + 3);
        }
      }
      // detections (additive glow)
      const shown = Math.ceil((sorted.length * t) / total);
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < Math.min(shown, sorted.length); i++) {
        const c = sorted[i];
        const x = px(c.lng), y = py(c.lat);
        const r = 1.2 + Math.sqrt(c.n / maxN) * (size.w / 55);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
        g.addColorStop(0, "rgba(254, 240, 138, 0.95)");
        g.addColorStop(0.35, "rgba(251, 146, 60, 0.55)");
        g.addColorStop(1, "rgba(234, 88, 12, 0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      // labels for the states with most detections
      if (t >= total) {
        ctx.font = "600 12px system-ui, sans-serif";
        const placed: { x: number; y: number; w: number }[] = [];
        for (const s of states.slice(0, 3)) {
          const label = `${s.state} · ${s.n.toLocaleString("pt-BR")}`;
          const w = ctx.measureText(label).width + 12;
          const x = Math.min(Math.max(px(s.lng) + 10, 2), size.w - w - 2);
          let y = Math.min(Math.max(py(s.lat) - 10, 16), size.h - 6);
          // simple collision avoidance: push down until it no longer overlaps a placed label
          while (placed.some((p) => x < p.x + p.w + 4 && p.x < x + w + 4 && Math.abs(p.y - y) < 24)) y += 24;
          placed.push({ x, y, w });
          ctx.fillStyle = "rgba(6, 26, 20, 0.75)";
          ctx.beginPath(); ctx.roundRect?.(x, y - 14, w, 20, 6); ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.fillText(label, x + 6, y);
        }
      }
    };

    const loop = () => {
      frame++;
      draw(Math.min(frame, total));
      if (frame < total) raf = requestAnimationFrame(loop);
    };
    if (reduce) draw(total); else loop();
    return () => cancelAnimationFrame(raf);
  }, [cells, states, size]);

  return (
    <div ref={wrap} className={className}>
      <canvas ref={canvas} style={{ width: size.w, height: size.h }} aria-hidden className="block max-w-full" />
    </div>
  );
}
