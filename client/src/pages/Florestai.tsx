/**
 * Florestaí — consulta pública de ocorrências (sem login).
 * Exibe somente lotes publicados explicitamente por organizações.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { differenceInCalendarDays, format, subDays } from "date-fns";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Search, Share2, Phone, Leaf, ShieldAlert, Info, Flame } from "lucide-react";
import { ArtemisMark } from "@/components/ArtemisMark";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { BR_STATES } from "@shared/br-states";
import { EMERGENCY_NOTICE, MODULE_MONITORING, PRODUCT_NAME } from "@shared/identity";

interface Point { date: string | null; time: string | null; municipality: string | null; state: string | null; latitude: number | null; longitude: number | null; type: string | null; source: string }
interface Summary {
  generatedAt: string; total: number;
  byMonth: { month: string; n: number }[]; byHour: { hour: number; n: number }[];
  topMunicipalities: { municipality: string; state: string; n: number }[];
  sources: { source: string; organization: string; batches: number; publishedAt: string }[];
  comparison: { current: { from: string | null; to: string | null; total: number }; previous: { from: string; to: string; total: number }; changePct: number | null } | null;
}

type Filters = { state: string; municipality: string; from: string; to: string; hourFrom: string; hourTo: string; compare: boolean };
const PRIMARY = "#0F5132";
const OCC = "#9a3412";

function readFilters(): Filters {
  const q = new URLSearchParams(window.location.search);
  return {
    state: q.get("state") ?? "", municipality: q.get("municipality") ?? "",
    from: q.get("from") ?? format(subDays(new Date(), 365), "yyyy-MM-dd"), to: q.get("to") ?? format(new Date(), "yyyy-MM-dd"),
    hourFrom: q.get("hourFrom") ?? "", hourTo: q.get("hourTo") ?? "", compare: q.get("compare") === "1",
  };
}

function toQuery(f: Filters) {
  const q = new URLSearchParams();
  if (f.state) q.set("state", f.state);
  if (f.municipality.trim()) q.set("municipality", f.municipality.trim());
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  if (f.hourFrom !== "") q.set("hourFrom", f.hourFrom);
  if (f.hourTo !== "") q.set("hourTo", f.hourTo);
  return q;
}

/** Previous period of equal length immediately before [from, to]. */
function previousPeriod(from: string, to: string) {
  const a = new Date(`${from}T12:00:00`), b = new Date(`${to}T12:00:00`);
  const len = differenceInCalendarDays(b, a) + 1;
  return { from: format(subDays(a, len), "yyyy-MM-dd"), to: format(subDays(a, 1), "yyyy-MM-dd") };
}

const BIOMES = [
  { name: "Cerrado", text: "Savana com vegetação adaptada ao fogo, mas sensível a queimadas frequentes e fora de época. Estação seca bem marcada, quando o risco aumenta." },
  { name: "Amazônia", text: "Floresta úmida que não é adaptada ao fogo. Incêndios costumam estar associados a desmatamento e manejo agropecuário." },
  { name: "Pantanal", text: "Planície alagável. Em secas prolongadas, a vegetação e o solo orgânico ressecados favorecem incêndios extensos e de difícil controle." },
  { name: "Caatinga", text: "Vegetação do semiárido. A biomassa seca no período de estiagem pode alimentar a propagação do fogo." },
  { name: "Mata Atlântica", text: "Floresta muito fragmentada. Incêndios em bordas de fragmentos e áreas de transição comprometem a regeneração." },
  { name: "Pampa", text: "Campos do Sul. O fogo é usado no manejo de pastagens; fora de controle, ameaça a vegetação nativa e propriedades." },
];

const TIPS = [
  "Não use fogo para limpeza de terreno ou queima de lixo — além do risco, pode ser crime ambiental e exige autorização do órgão competente.",
  "Mantenha aceiros (faixas sem vegetação) ao redor de construções, cercas e áreas de cultivo.",
  "Não jogue bitucas de cigarro nem deixe garrafas e vidros em áreas de vegetação.",
  "Em períodos secos e com vento forte, adie qualquer atividade que gere faíscas.",
  "Ao avistar fumaça ou fogo, afaste-se e acione o 193. Não tente combater incêndios sem treinamento e equipamento.",
  "Se a fumaça chegar à sua casa: feche portas e janelas, mantenha-se hidratado e procure atendimento de saúde se houver falta de ar.",
];

export default function Florestai() {
  const [form, setForm] = useState<Filters>(readFilters);
  const [applied, setApplied] = useState<Filters>(form);
  const [copied, setCopied] = useState(false);

  const query = useMemo(() => {
    const q = toQuery(applied);
    if (applied.compare && applied.from && applied.to) {
      const p = previousPeriod(applied.from, applied.to);
      q.set("compareFrom", p.from);
      q.set("compareTo", p.to);
    }
    return q.toString();
  }, [applied]);

  const { data: municipalities = [] } = useQuery<string[]>({
    queryKey: ["/api/public/municipalities", form.state],
    queryFn: () => api("GET", `/api/public/municipalities${form.state ? `?state=${form.state}` : ""}`),
  });
  const { data: summary, error } = useQuery<Summary>({ queryKey: ["/api/public/summary", query], queryFn: () => api("GET", `/api/public/summary?${query}`) });
  const { data: occ } = useQuery<{ points: Point[]; truncated: boolean; notice: string }>({
    queryKey: ["/api/public/occurrences", query], queryFn: () => api("GET", `/api/public/occurrences?${query}`),
  });
  const mapped = (occ?.points ?? []).filter((p) => p.latitude != null && p.longitude != null);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    setApplied(form);
    const q = toQuery(form);
    if (form.compare) q.set("compare", "1");
    window.history.replaceState(null, "", `/florestai?${q.toString()}`);
  }

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: `${MODULE_MONITORING} — ${PRODUCT_NAME}`, url });
      else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    } catch { /* user cancelled */ }
  }

  const input = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";
  const label = "text-xs font-medium text-muted-foreground block mb-1";
  const center: [number, number] = mapped.length ? [mapped[0].latitude!, mapped[0].longitude!] : [-14.5, -51];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 font-bold"><ArtemisMark className="w-8 h-8" />{PRODUCT_NAME}</Link>
          <nav className="flex items-center gap-3 text-sm">
            <a href="#prevencao" className="hidden sm:inline hover:underline">Prevenção</a>
            <Link href="/login" className="font-semibold text-primary hover:underline">Entrar</Link>
          </nav>
        </div>
        <p className="bg-red-50 text-red-900 border-t border-red-200 text-xs sm:text-sm px-4 py-2 text-center flex items-center justify-center gap-2">
          <Phone className="w-4 h-4 shrink-0" aria-hidden />{EMERGENCY_NOTICE}
        </p>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <section>
          <h1 className="text-3xl font-bold font-display flex items-center gap-2"><Leaf className="w-7 h-7 text-primary" aria-hidden />{MODULE_MONITORING}</h1>
          <p className="text-muted-foreground mt-1 max-w-3xl">
            Consulta pública de ocorrências de queimadas e incêndios registradas por organizações que optaram por publicar seus dados na ARTEMIS AI.
          </p>
          <p className="text-xs mt-2 text-amber-950 bg-amber-50 border border-amber-200 rounded-lg p-2 max-w-3xl">
            São registros históricos importados — não são focos de calor por satélite, não são monitoramento em tempo real e a cobertura depende de quem publicou.
            Coordenadas aproximadas (~1 km). Ausência de registros não significa ausência de fogo.
          </p>
        </section>

        <form onSubmit={apply} className="bg-card border rounded-2xl p-4 grid grid-cols-2 md:grid-cols-6 gap-3 items-end" aria-label="Filtros da consulta">
          <div><label htmlFor="f-uf" className={label}>UF</label>
            <select id="f-uf" className={input} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value, municipality: "" })}>
              <option value="">Todas</option>{BR_STATES.map((s) => <option key={s}>{s}</option>)}
            </select></div>
          <div className="col-span-2 md:col-span-1"><label htmlFor="f-mun" className={label}>Município</label>
            <input id="f-mun" list="mun-list" className={input} value={form.municipality} onChange={(e) => setForm({ ...form, municipality: e.target.value })} placeholder="Todos" />
            <datalist id="mun-list">{municipalities.map((m) => <option key={m} value={m} />)}</datalist></div>
          <div><label htmlFor="f-from" className={label}>De</label><input id="f-from" type="date" className={input} value={form.from} max={form.to} onChange={(e) => setForm({ ...form, from: e.target.value })} /></div>
          <div><label htmlFor="f-to" className={label}>Até</label><input id="f-to" type="date" className={input} value={form.to} min={form.from} onChange={(e) => setForm({ ...form, to: e.target.value })} /></div>
          <fieldset className="col-span-2 md:col-span-1"><legend className={label}>Horário (h)</legend>
            <div className="flex gap-1 items-center">
              <label htmlFor="f-h1" className="sr-only">Hora inicial</label>
              <input id="f-h1" type="number" min={0} max={23} className={input} value={form.hourFrom} onChange={(e) => setForm({ ...form, hourFrom: e.target.value })} placeholder="0" />
              <span aria-hidden>–</span>
              <label htmlFor="f-h2" className="sr-only">Hora final</label>
              <input id="f-h2" type="number" min={0} max={23} className={input} value={form.hourTo} onChange={(e) => setForm({ ...form, hourTo: e.target.value })} placeholder="23" />
            </div></fieldset>
          <div className="col-span-2 md:col-span-1 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.compare} onChange={(e) => setForm({ ...form, compare: e.target.checked })} />Comparar com período anterior</label>
            <Button type="submit" className="w-full"><Search className="w-4 h-4 mr-1" aria-hidden />Consultar</Button>
          </div>
        </form>

        {error && <p role="alert" className="text-red-700">{(error as Error).message}</p>}

        {summary && (
          <section aria-live="polite" className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-card border rounded-2xl p-4"><p className="text-xs text-muted-foreground">Ocorrências no filtro</p><p className="text-3xl font-bold tabular-nums">{summary.total.toLocaleString("pt-BR")}</p></div>
            {summary.comparison && (
              <div className="bg-card border rounded-2xl p-4">
                <p className="text-xs text-muted-foreground">Período anterior ({format(new Date(`${summary.comparison.previous.from}T12:00:00`), "dd/MM/yy")}–{format(new Date(`${summary.comparison.previous.to}T12:00:00`), "dd/MM/yy")})</p>
                <p className="text-3xl font-bold tabular-nums">{summary.comparison.previous.total.toLocaleString("pt-BR")}</p>
                <p className="text-xs">{summary.comparison.changePct == null ? "variação indisponível (período anterior sem registros)" : `${summary.comparison.changePct > 0 ? "+" : ""}${summary.comparison.changePct}% em relação ao anterior`}</p>
              </div>
            )}
            <div className="bg-card border rounded-2xl p-4 col-span-2 flex flex-col justify-between gap-2">
              <p className="text-xs text-muted-foreground">Compartilhe esta consulta com os filtros aplicados</p>
              <Button type="button" variant="outline" onClick={share}><Share2 className="w-4 h-4 mr-1" aria-hidden />{copied ? "Link copiado" : "Compartilhar"}</Button>
            </div>
          </section>
        )}

        <section className="rounded-2xl overflow-hidden border h-[55vh] min-h-[320px]" aria-label="Mapa de ocorrências">
          <MapContainer key={query} center={center} zoom={mapped.length ? 8 : 4} className="h-full w-full" scrollWheelZoom={false}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
            {mapped.map((p, i) => (
              <CircleMarker key={i} center={[p.latitude!, p.longitude!]} radius={5} pathOptions={{ color: "#fff", weight: 1, fillColor: OCC, fillOpacity: 0.85 }}>
                <Popup>{p.date ?? "data não informada"} {p.time ?? ""}<br />{p.municipality ?? "—"}/{p.state ?? "—"}{p.type && <><br />{p.type}</>}<br />Fonte: {p.source || "—"}</Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </section>
        {occ?.truncated && <p className="text-xs text-muted-foreground">Mostrando os 3.000 registros mais recentes. Refine os filtros para ver todos.</p>}

        {summary && summary.total > 0 && (
          <div className="grid lg:grid-cols-2 gap-6">
            <section className="bg-card border rounded-2xl p-5">
              <h2 className="font-semibold">Ocorrências por mês</h2>
              <div className="h-52 mt-3" aria-hidden>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={summary.byMonth} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => [v, "Ocorrências"]} />
                    <Bar dataKey="n" fill={PRIMARY} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <details className="text-sm mt-2"><summary className="cursor-pointer text-muted-foreground">Ver em tabela</summary>
                <table className="w-full text-xs mt-2"><thead><tr className="text-left text-muted-foreground"><th>Mês</th><th>Ocorrências</th></tr></thead>
                  <tbody>{summary.byMonth.map((m) => <tr key={m.month} className="border-t"><td className="py-1">{m.month}</td><td>{m.n}</td></tr>)}</tbody></table></details>
            </section>
            <section className="bg-card border rounded-2xl p-5">
              <h2 className="font-semibold">Ocorrências por horário do registro</h2>
              <div className="h-52 mt-3" aria-hidden>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={summary.byHour} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} tickFormatter={(h) => `${h}h`} interval={2} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip labelFormatter={(h) => `${h}h`} formatter={(v: number) => [v, "Ocorrências"]} />
                    <Bar dataKey="n" fill={PRIMARY} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Somente registros com horário informado.</p>
            </section>
            <section className="bg-card border rounded-2xl p-5">
              <h2 className="font-semibold mb-2">Municípios com mais registros</h2>
              <ol className="divide-y text-sm">{summary.topMunicipalities.map((m) => (
                <li key={`${m.municipality}-${m.state}`} className="flex justify-between py-1.5"><span>{m.municipality}/{m.state}</span><span className="tabular-nums font-semibold">{m.n}</span></li>))}</ol>
            </section>
            <section className="bg-card border rounded-2xl p-5">
              <h2 className="font-semibold mb-2">Quem publicou estes dados</h2>
              <ul className="text-sm space-y-1">{summary.sources.map((s, i) => (
                <li key={i}>• <strong>{s.organization}</strong> — {s.source || "fonte não informada"} ({s.batches} lote(s){s.publishedAt ? `, publicado em ${format(new Date(s.publishedAt), "dd/MM/yyyy")}` : ""})</li>))}</ul>
              <p className="text-xs text-muted-foreground mt-2">Importações de arquivos. Não representam integração oficial com Sisfogo, INPE ou outro órgão.</p>
            </section>
          </div>
        )}
        {summary && summary.total === 0 && (
          <p className="text-sm text-muted-foreground bg-card border rounded-2xl p-6 text-center">
            <Flame className="w-6 h-6 mx-auto mb-2 opacity-40" aria-hidden />Nenhum registro publicado para este filtro.
          </p>
        )}

        <section id="prevencao" className="grid lg:grid-cols-2 gap-6">
          <div className="bg-card border rounded-2xl p-5">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-primary" aria-hidden />Prevenção e segurança</h2>
            <ul className="list-disc list-inside text-sm space-y-2">{TIPS.map((t, i) => <li key={i}>{t}</li>)}</ul>
            <p className="text-sm mt-4 font-semibold">Emergência: Corpo de Bombeiros 193 · Defesa Civil 199 · SAMU 192</p>
          </div>
          <div className="bg-card border rounded-2xl p-5">
            <h2 className="font-semibold mb-3 flex items-center gap-2"><Leaf className="w-5 h-5 text-primary" aria-hidden />Fogo nos biomas brasileiros</h2>
            <dl className="space-y-2 text-sm">{BIOMES.map((b) => <div key={b.name}><dt className="font-semibold">{b.name}</dt><dd className="text-muted-foreground">{b.text}</dd></div>)}</dl>
          </div>
        </section>

        <footer className="text-xs text-muted-foreground border-t pt-4 flex flex-col sm:flex-row justify-between gap-2">
          <span className="flex items-center gap-1"><Info className="w-3.5 h-3.5" aria-hidden />Mapa © colaboradores do OpenStreetMap.</span>
          <span><Link href="/privacidade" className="underline">Privacidade</Link> · <Link href="/simulacao" className="underline">Simular risco</Link></span>
        </footer>
      </main>
    </div>
  );
}
