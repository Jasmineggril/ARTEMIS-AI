import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Flame, Info, AlertTriangle, CheckCircle2, Printer, Thermometer, MapPin, Cpu, FlaskConical,
  Database, History, Bell, CloudSun, ShieldAlert,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { RiskBadge, riskLevelColor, riskLevelDescription } from "@/components/RiskBadge";
import { HelpTooltip } from "@/components/HelpTooltip";
import { AnalysisTutorial } from "@/components/AnalysisTutorial";
import { useToast } from "@/hooks/use-toast";
import { useAuthStatus, hasRole } from "@/hooks/use-auth";
import { api, ApiError } from "@/lib/api";
import { ORIGIN_LABEL, NATURE_OF, NATURE_LABEL, FIELD_LABEL } from "@/lib/data-nature";
import { cn } from "@/lib/utils";
import { DEMO_SCENARIOS, type RiskLevel } from "@shared/risk-engine";
import { DECISION_SUPPORT_DISCLAIMER } from "@shared/identity";
import type { MonitoredArea, RiskAnalysis as StoredAnalysis } from "@shared/schema";

const VEG = [
  { v: "very_dry", label: "Muito seca" }, { v: "dry", label: "Seca" },
  { v: "moderate", label: "Moderada" }, { v: "humid", label: "Úmida" },
] as const;
const VEG_FROM_NUM = ["very_dry", "dry", "moderate", "humid"] as const;
const QUALITY = [
  { v: "", label: "Derivar automaticamente" }, { v: "poor", label: "Ruim" }, { v: "regular", label: "Regular" },
  { v: "good", label: "Boa" }, { v: "excellent", label: "Excelente" },
] as const;

interface Factor { name: string; contribution: number; description: string; weight: string; value: string }
interface Recommendation { priority: string; action: string; rationale: string }

/** Normalised view model for both stored analyses and public simulations. */
interface ResultView {
  mode: "area" | "simulation";
  id?: number;
  score: number;
  level: RiskLevel;
  factors: Factor[];
  recommendations: Recommendation[];
  engineType: string;
  version: string;
  isExperimental: boolean;
  at: string;
  areaName?: string;
  dataSources?: { key: string; name: string; referenceAt?: string; licence?: string }[];
  provenance?: { field: string; origin: string; referenceAt?: string }[];
  qualityLabel?: string;
  limitations?: string[];
  alert?: { id: number; created: boolean } | null;
}

interface FormState {
  temperature: string; humidity: string; windSpeed: string; recentRainfall: string;
  vegetationCondition: string; nearbyHotspot: "auto" | "sim" | "nao"; hotspotDistance: string;
  historicalOccurrences: string; dataQuality: string; useLiveWeather: boolean; notes: string;
}
const DEFAULT_FORM: FormState = {
  temperature: "", humidity: "", windSpeed: "", recentRainfall: "", vegetationCondition: "moderate",
  nearbyHotspot: "auto", hotspotDistance: "", historicalOccurrences: "", dataQuality: "", useLiveWeather: true, notes: "",
};

function engineLabel(t: string) {
  if (t === "supervised-ml") return "Modelo supervisionado EXPERIMENTAL (dataset sintético)";
  if (t.endsWith("ts-fallback")) return "Motor de regras transparente (TypeScript, fallback)";
  if (t.startsWith("transparent-rule-engine")) return "Motor de regras transparente";
  return t;
}

function fromStored(a: StoredAnalysis & { alert?: ResultView["alert"] }, areaName?: string): ResultView {
  const dq = (a.dataQuality ?? {}) as any;
  return {
    mode: "area", id: a.id, score: a.score, level: a.level as RiskLevel,
    factors: (a.factors as Factor[]) ?? [], recommendations: (a.recommendations as Recommendation[]) ?? [],
    engineType: a.engineType ?? "desconhecido", version: a.calculationVersion ?? "", isExperimental: a.isExperimental,
    at: String(a.createdAt), areaName, dataSources: (a.dataSources as any[]) ?? [], provenance: dq.provenance ?? [],
    qualityLabel: dq.level, limitations: (a.limitations as string[]) ?? [], alert: a.alert,
  };
}

function ScoreGauge({ score, level }: { score: number; level: RiskLevel }) {
  const r = 52, circ = 2 * Math.PI * r, color = riskLevelColor(level);
  return (
    <div className="flex flex-col items-center">
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label={`Índice de risco ${score} de 100`}>
        <circle cx="70" cy="70" r={r} fill="none" className="stroke-muted" strokeWidth="14" />
        <circle cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="14" strokeDasharray={`${(score / 100) * circ} ${circ}`}
          strokeDashoffset={circ / 4} strokeLinecap="round" />
        <text x="70" y="64" textAnchor="middle" fontSize="28" fontWeight="bold" fill={color}>{score}</text>
        <text x="70" y="82" textAnchor="middle" fontSize="11" className="fill-muted-foreground">/100</text>
      </svg>
      <RiskBadge level={level} score={score} size="md" showIcon className="mt-1" />
    </div>
  );
}

const priorityColor: Record<string, string> = {
  imediata: "text-red-800 bg-red-50 border-red-200", urgente: "text-orange-800 bg-orange-50 border-orange-200",
  preventiva: "text-amber-800 bg-amber-50 border-amber-200", monitoramento: "text-sky-800 bg-sky-50 border-sky-200",
};

const inputCls = "w-full px-3 py-2 text-sm border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring";

function NumberField({ id, label, value, onChange, placeholder, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      <input id={id} type="number" inputMode="decimal" step="any" className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} aria-describedby={hint ? `${id}-hint` : undefined} />
      {hint && <p id={`${id}-hint`} className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

export default function RiskAnalysisPage() {
  const { data: user, isLoading: authLoading } = useAuthStatus();
  const { toast } = useToast();
  const qc = useQueryClient();
  const initialArea = Number(new URLSearchParams(window.location.search).get("area")) || null;

  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  // Proof of Value: time from opening the form to the result (sent with the analysis)
  const formOpenedAt = useRef(Date.now());
  const [areaId, setAreaId] = useState<number | null>(initialArea);
  const [result, setResult] = useState<ResultView | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const canAnalyze = hasRole(user, "analyst");
  const areaMode = !!user && canAnalyze;

  const { data: areas = [] } = useQuery<MonitoredArea[]>({
    queryKey: ["/api/areas"], queryFn: () => api("GET", "/api/areas"), enabled: areaMode,
  });
  useEffect(() => {
    if (areaMode && !areaId && areas.length > 0) setAreaId(areas[0].id);
  }, [areaMode, areas, areaId]);
  const area = useMemo(() => areas.find((a) => a.id === areaId) ?? null, [areas, areaId]);

  const { data: history = [] } = useQuery<StoredAnalysis[]>({
    queryKey: ["/api/areas", areaId, "analyses"],
    queryFn: () => api("GET", `/api/areas/${areaId}/analyses?limit=20`),
    enabled: areaMode && !!areaId,
  });

  function applyScenario(key: string) {
    const s = DEMO_SCENARIOS[key];
    if (!s) return;
    const i = s.input;
    setForm((f) => ({
      ...f, temperature: String(i.temperature), humidity: String(i.humidity), windSpeed: String(i.windSpeed),
      recentRainfall: String(i.recentRainfall), vegetationCondition: VEG_FROM_NUM[i.vegetationCondition],
      nearbyHotspot: i.nearbyHotspot ? "sim" : "nao", hotspotDistance: String(i.hotspotDistance),
      historicalOccurrences: String(i.historicalOccurrences), useLiveWeather: false,
    }));
    toast({ title: `Cenário demonstrativo "${s.label}" carregado`, description: "Valores fictícios para teste — não representam medições." });
  }

  const num = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(",", ".")));

  async function analyze() {
    const values = {
      temperature: num(form.temperature), humidity: num(form.humidity), windSpeed: num(form.windSpeed),
      recentRainfall: num(form.recentRainfall), hotspotDistance: num(form.hotspotDistance),
      historicalOccurrences: num(form.historicalOccurrences),
    };
    const errs: string[] = [];
    Object.entries(values).forEach(([k, v]) => { if (v !== undefined && Number.isNaN(v)) errs.push(`${FIELD_LABEL[k] ?? k}: valor inválido.`); });
    if (values.humidity !== undefined && (values.humidity < 0 || values.humidity > 100)) errs.push("Umidade deve estar entre 0 e 100%.");
    const meteoMissing = [values.temperature, values.humidity, values.windSpeed, values.recentRainfall].some((v) => v === undefined);
    if (meteoMissing && !(areaMode && form.useLiveWeather)) errs.push("Informe temperatura, umidade, vento e precipitação (ou ative os dados meteorológicos automáticos).");
    if (areaMode && !areaId) errs.push("Selecione uma área.");
    setErrors(errs);
    if (errs.length) return;

    setBusy(true);
    try {
      if (areaMode) {
        const body = {
          useLiveWeather: form.useLiveWeather,
          notes: form.notes.trim() || undefined,
          clientDurationMs: Math.min(Date.now() - formOpenedAt.current, 86_400_000),
          inputs: Object.fromEntries(Object.entries({
            ...values,
            hotspotDistance: form.nearbyHotspot === "sim" ? values.hotspotDistance : undefined,
            vegetationCondition: form.vegetationCondition,
            // "auto" = omit: the server checks INPE satellite detections (when data is fresh)
            nearbyHotspot: form.nearbyHotspot === "auto" ? undefined : form.nearbyHotspot === "sim",
            dataQuality: form.dataQuality || undefined,
          }).filter(([, v]) => v !== undefined)),
        };
        const stored = await api<StoredAnalysis & { alert: ResultView["alert"] }>("POST", `/api/areas/${areaId}/analyses`, body);
        formOpenedAt.current = Date.now();
        setResult(fromStored(stored, area?.name));
        qc.invalidateQueries({ queryKey: ["/api/areas"] });
        qc.invalidateQueries({ queryKey: ["/api/alerts"] });
        qc.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
        if (stored.alert) {
          toast({ title: stored.alert.created ? "Alerta emitido" : "Alerta existente atualizado", description: `Alerta #${stored.alert.id}` });
        }
      } else {
        const r = await api<any>("POST", "/api/python-risk-analysis", {
          temperature: values.temperature, humidity: values.humidity, wind_speed: values.windSpeed,
          recent_rainfall: values.recentRainfall, vegetation_condition: form.vegetationCondition,
          nearby_hotspot: form.nearbyHotspot === "sim", hotspot_distance: form.nearbyHotspot === "sim" ? values.hotspotDistance ?? null : null,
          historical_occurrences: values.historicalOccurrences ?? 0, data_quality: form.dataQuality || "regular",
        });
        setResult({
          mode: "simulation", score: r.score, level: (r.level === "critico" ? "crítico" : r.level) as RiskLevel,
          factors: r.factors ?? [], recommendations: r.recommendations ?? [], engineType: r.model_type,
          version: r.model_version, isExperimental: Boolean(r.is_experimental), at: r.calculated_at,
        });
      }
      setTimeout(() => document.getElementById("result")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Falha na análise.";
      setErrors([msg]);
    } finally {
      setBusy(false);
    }
  }

  if (authLoading) return <Layout><p className="text-muted-foreground">Carregando...</p></Layout>;

  return (
    <Layout>
      {tutorial && <AnalysisTutorial onClose={() => setTutorial(false)} />}
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display flex items-center gap-2"><Flame className="w-8 h-8 text-primary" aria-hidden />Análise Preditiva de Risco</h1>
          <p className="text-muted-foreground mt-1">
            ARTEMIS AI · {areaMode ? "análise armazenada e auditável da área selecionada" : "simulação pública — o resultado não é armazenado"}
          </p>
        </div>
        <button onClick={() => setTutorial(true)} className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm text-muted-foreground hover:bg-secondary/50">
          <Info className="w-4 h-4" aria-hidden /> Como funciona?
        </button>
      </header>

      {!user && (
        <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50 text-sky-900 p-4 text-sm">
          Você está no modo de <strong>simulação</strong>. Para analisar e acompanhar áreas reais da sua organização, <Link href="/login" className="underline font-semibold">entre</Link> ou <Link href="/signup" className="underline font-semibold">crie uma conta</Link>.
        </div>
      )}
      {user && !canAnalyze && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 p-4 text-sm">
          Seu papel na organização é de leitura. Peça a um administrador o papel de analista para executar análises de áreas. Simulações continuam disponíveis.
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          {areaMode && (
            <section className="bg-card border rounded-2xl p-6 space-y-3" aria-labelledby="sec-area">
              <h2 id="sec-area" className="font-semibold flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" aria-hidden />Área avaliada</h2>
              {areas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma área cadastrada. <Link href="/areas" className="underline">Cadastre uma área</Link> para analisar.</p>
              ) : (
                <>
                  <label htmlFor="area" className="sr-only">Área</label>
                  <select id="area" className={inputCls} value={areaId ?? ""} onChange={(e) => { setAreaId(Number(e.target.value)); setResult(null); }}>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.municipality}/{a.state}</option>)}
                  </select>
                  {area && (
                    <p className="text-xs text-muted-foreground">
                      {area.latitude != null ? `Coordenadas ${area.latitude.toFixed(4)}, ${area.longitude!.toFixed(4)}` : "Área sem coordenadas — dados meteorológicos automáticos indisponíveis."}
                      {area.areaHectares != null && ` · ${area.areaHectares.toLocaleString("pt-BR")} ha`}
                    </p>
                  )}
                </>
              )}
            </section>
          )}

          <section className="bg-card border rounded-2xl p-6 space-y-4" aria-labelledby="sec-data">
            <h2 id="sec-data" className="font-semibold flex items-center gap-2">
              <Thermometer className="w-4 h-4 text-primary" aria-hidden /> Dados ambientais
              <HelpTooltip text="Valores informados manualmente têm prioridade. Campos meteorológicos vazios podem ser preenchidos pelo Open-Meteo, quando ativado. Nada é preenchido com valores padrão." />
            </h2>
            {areaMode && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={form.useLiveWeather} onChange={(e) => set("useLiveWeather", e.target.checked)} />
                <span><CloudSun className="inline w-4 h-4 mr-1" aria-hidden />Preencher campos meteorológicos vazios com dados do Open-Meteo para as coordenadas da área
                  <span className="block text-xs text-muted-foreground">Estimativa de modelo numérico, não medição local. Se a fonte falhar, a análise não é executada com valores inventados.</span></span>
              </label>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <NumberField id="t" label="Temperatura do ar (°C)" value={form.temperature} onChange={(v) => set("temperature", v)} placeholder={areaMode && form.useLiveWeather ? "automático" : "Ex.: 36"} />
              <NumberField id="h" label="Umidade relativa (%)" value={form.humidity} onChange={(v) => set("humidity", v)} placeholder={areaMode && form.useLiveWeather ? "automático" : "Ex.: 20"} />
              <NumberField id="w" label="Velocidade do vento (km/h)" value={form.windSpeed} onChange={(v) => set("windSpeed", v)} placeholder={areaMode && form.useLiveWeather ? "automático" : "Ex.: 25"} />
              <NumberField id="r" label="Precipitação nas últimas 72 h (mm)" value={form.recentRainfall} onChange={(v) => set("recentRainfall", v)} placeholder={areaMode && form.useLiveWeather ? "automático" : "Ex.: 0"} />
              <div>
                <label htmlFor="veg" className="text-xs font-medium text-muted-foreground mb-1 block">Condição da vegetação</label>
                <select id="veg" className={inputCls} value={form.vegetationCondition} onChange={(e) => set("vegetationCondition", e.target.value)}>
                  {VEG.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </div>
              <NumberField id="hist" label="Ocorrências históricas na área" value={form.historicalOccurrences} onChange={(v) => set("historicalOccurrences", v)}
                hint={areaMode ? "Vazio = contar ocorrências importadas num raio de 10 km." : undefined} />
            </div>
            <div>
              <label htmlFor="hs" className="text-xs font-medium text-muted-foreground mb-1 block">Foco de calor ou incêndio próximo à área</label>
              <select id="hs" className={inputCls} value={areaMode ? form.nearbyHotspot : form.nearbyHotspot === "auto" ? "nao" : form.nearbyHotspot}
                onChange={(e) => set("nearbyHotspot", e.target.value as FormState["nearbyHotspot"])} aria-describedby="hs-hint">
                {areaMode && <option value="auto">Verificar automaticamente (focos do INPE, raio de 10 km, últimas 48 h)</option>}
                <option value="sim">Sim, há foco conhecido</option>
                <option value="nao">Não há foco conhecido</option>
              </select>
              <p id="hs-hint" className="text-[11px] text-muted-foreground mt-0.5">
                {areaMode ? "A verificação automática só é usada se os dados do INPE estiverem atualizados; caso contrário, a análise registra que não foi verificada." : "Na simulação, informe manualmente."}
              </p>
              {form.nearbyHotspot === "sim" && (
                <div className="mt-2"><NumberField id="dist" label="Distância estimada (km)" value={form.hotspotDistance} onChange={(v) => set("hotspotDistance", v)} /></div>
              )}
            </div>
            <div>
              <label htmlFor="q" className="text-xs font-medium text-muted-foreground mb-1 block">Qualidade declarada dos dados</label>
              <select id="q" className={inputCls} value={form.dataQuality} onChange={(e) => set("dataQuality", e.target.value)}>
                {QUALITY.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
            {areaMode && (
              <div>
                <label htmlFor="notes" className="text-xs font-medium text-muted-foreground mb-1 block">Observações (opcional)</label>
                <textarea id="notes" className={`${inputCls} h-16`} value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} />
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-2">Cenários demonstrativos (valores fictícios para teste):</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(DEMO_SCENARIOS).map(([k, s]) => <Button key={k} type="button" variant="outline" size="sm" onClick={() => applyScenario(k)}>{s.label}</Button>)}
              </div>
            </div>
          </section>

          {errors.length > 0 && (
            <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-4">
              <ul className="list-disc list-inside space-y-1 text-sm text-red-800">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}

          <Button onClick={analyze} disabled={busy || (areaMode && areas.length === 0)} size="lg" className="w-full font-bold" data-testid="button-analyze">
            {busy ? "Analisando..." : <><Flame className="w-5 h-5 mr-2" aria-hidden />{areaMode ? "Analisar e registrar" : "Simular risco"}</>}
          </Button>
          <p className="text-xs text-muted-foreground flex items-start gap-1"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />{DECISION_SUPPORT_DISCLAIMER}</p>
        </div>

        <div className="space-y-5" id="result" aria-live="polite">
          {result ? (
            <>
              <section className="bg-card border rounded-2xl p-6">
                <div className="flex flex-col items-center gap-3">
                  <ScoreGauge score={result.score} level={result.level} />
                  <p className="text-sm text-muted-foreground text-center">{riskLevelDescription(result.level)}</p>
                  <dl className="text-xs text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 w-full max-w-sm">
                    {result.id && (<><dt>Análise</dt><dd>#{result.id}{result.areaName ? ` · ${result.areaName}` : ""}</dd></>)}
                    <dt>Processada em</dt><dd>{format(new Date(result.at), "dd/MM/yyyy 'às' HH:mm:ss", { locale: ptBR })}</dd>
                    <dt>Motor</dt><dd>{engineLabel(result.engineType)}</dd>
                    <dt>Versão</dt><dd className="break-all">{result.version}</dd>
                    {result.qualityLabel && (<><dt>Qualidade</dt><dd>{result.qualityLabel}</dd></>)}
                  </dl>
                  {result.mode === "simulation" && (
                    <span className="text-xs bg-sky-50 text-sky-800 border border-sky-200 px-2 py-0.5 rounded-full">Simulação — não armazenada</span>
                  )}
                  {result.isExperimental && (
                    <span className="text-xs bg-violet-50 text-violet-800 border border-violet-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <FlaskConical className="w-3 h-3" aria-hidden />Resultado experimental — modelo treinado com dados sintéticos
                    </span>
                  )}
                  {result.alert && (
                    <Link href="/alerts" className="text-sm font-medium flex items-center gap-1 text-orange-800 underline">
                      <Bell className="w-4 h-4" aria-hidden />{result.alert.created ? "Alerta emitido" : "Alerta aberto atualizado"} (#{result.alert.id})
                    </Link>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => window.print()} className="w-full mt-4"><Printer className="w-4 h-4 mr-2" aria-hidden />Imprimir / salvar em PDF</Button>
              </section>

              <section className="bg-card border rounded-2xl p-6" aria-labelledby="sec-factors">
                <h3 id="sec-factors" className="font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden />Fatores que influenciaram o índice</h3>
                <ul className="space-y-2">
                  {result.factors.map((f, i) => (
                    <li key={i} className="flex items-start gap-3 p-3 bg-muted/30 rounded-xl">
                      <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded shrink-0", f.contribution > 0 ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800")}>
                        {f.contribution > 0 ? `+${f.contribution}` : f.contribution} pts
                      </span>
                      <div className="min-w-0"><p className="text-sm font-semibold">{f.name} <span className="text-muted-foreground font-normal">— {f.value}</span></p>
                        <p className="text-xs text-muted-foreground">{f.description}</p></div>
                    </li>
                  ))}
                  {result.factors.length === 0 && <li className="text-sm text-muted-foreground">Nenhum fator elevou o índice.</li>}
                </ul>
              </section>

              {result.mode === "area" && (
                <section className="bg-card border rounded-2xl p-6" aria-labelledby="sec-src">
                  <h3 id="sec-src" className="font-semibold mb-3 flex items-center gap-2"><Database className="w-4 h-4 text-primary" aria-hidden />Fontes e procedência dos dados</h3>
                  <ul className="text-sm space-y-1 mb-3">
                    {result.dataSources?.map((s) => (
                      <li key={s.key}>• {s.name}{s.referenceAt && ` — referência ${format(new Date(s.referenceAt), "dd/MM/yyyy HH:mm")} UTC`}{s.licence && <span className="text-xs text-muted-foreground"> ({s.licence})</span>}</li>
                    ))}
                  </ul>
                  <table className="w-full text-xs" data-testid="table-provenance"><caption className="sr-only">Procedência por variável</caption>
                    <thead><tr className="text-left text-muted-foreground"><th className="py-1">Variável</th><th>Natureza</th><th>Origem</th></tr></thead>
                    <tbody>
                      {result.provenance?.map((p, i) => {
                        const n = NATURE_LABEL[NATURE_OF[p.origin] ?? "informado"];
                        return <tr key={`${p.field}-${i}`} className="border-t"><td className="py-1">{FIELD_LABEL[p.field] ?? p.field}</td>
                          <td><span title={n.help} className={cn("inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium", n.cls)}>{n.label}</span></td>
                          <td>{ORIGIN_LABEL[p.origin] ?? p.origin}</td></tr>;
                      })}
                      <tr className="border-t"><td className="py-1 font-medium">Índice e nível de risco</td>
                        <td><span className="inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-900 border-emerald-300">Calculado</span></td>
                        <td>resultado do motor de análise de risco a partir das variáveis acima</td></tr>
                    </tbody>
                  </table>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    <b>Informado</b>: digitado, não verificado · <b>Estimativa</b>: modelo, não medição local · <b>Observado</b>: satélite, não é incêndio confirmado ·
                    <b> Registro oficial</b>: Sisfogo · <b>Calculado</b>: resultado do modelo, com as limitações abaixo.</p>
                </section>
              )}

              <section className="bg-card border rounded-2xl p-6" aria-labelledby="sec-rec">
                <h3 id="sec-rec" className="font-semibold mb-3 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-700" aria-hidden />Recomendações preventivas</h3>
                <ul className="space-y-2">
                  {result.recommendations.map((r, i) => (
                    <li key={i} className={cn("p-3 rounded-xl border text-sm", priorityColor[r.priority] ?? "bg-muted/30")}>
                      <p className="font-semibold"><span className="capitalize">{r.priority}</span>: {r.action}</p>
                      <p className="text-xs opacity-90">{r.rationale}</p>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="bg-amber-50 text-amber-950 border border-amber-200 rounded-2xl p-5" aria-labelledby="sec-lim">
                <h3 id="sec-lim" className="font-semibold mb-2 flex items-center gap-2"><ShieldAlert className="w-4 h-4" aria-hidden />Limitações e incertezas</h3>
                <ul className="list-disc list-inside text-xs space-y-1">
                  {(result.limitations ?? [
                    "Simulação com valores informados pelo usuário, não verificados.",
                    "Limiares do motor de regras ainda não calibrados com dados reais de incêndio.",
                    DECISION_SUPPORT_DISCLAIMER,
                  ]).map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </section>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center min-h-[300px] text-center bg-muted/20 border border-dashed rounded-2xl p-10">
              <Flame className="w-12 h-12 text-muted-foreground/30 mb-4" aria-hidden />
              <p className="font-semibold text-muted-foreground">O resultado aparecerá aqui</p>
            </div>
          )}

          {areaMode && history.length > 0 && (
            <section className="bg-card border rounded-2xl p-6" aria-labelledby="sec-hist">
              <h3 id="sec-hist" className="font-semibold mb-3 flex items-center gap-2"><History className="w-4 h-4 text-primary" aria-hidden />Histórico da área</h3>
              <ul className="divide-y text-sm">
                {history.map((h) => (
                  <li key={h.id}>
                    <button className="w-full flex items-center justify-between gap-2 py-2 text-left hover:bg-muted/30 rounded" onClick={() => setResult(fromStored(h, area?.name))}>
                      <span>#{h.id} · {format(new Date(String(h.createdAt)), "dd/MM/yyyy HH:mm", { locale: ptBR })}{h.isExperimental && " · experimental"}</span>
                      <RiskBadge level={h.level as RiskLevel} score={h.score} size="sm" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </Layout>
  );
}
