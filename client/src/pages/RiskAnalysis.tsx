import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { RiskBadge, riskLevelColor, riskLevelDescription } from "@/components/RiskBadge";
import { HelpTooltip } from "@/components/HelpTooltip";
import { AnalysisTutorial } from "@/components/AnalysisTutorial";
import {
  DEMO_SCENARIOS,
  type RiskInput, type RiskLevel
} from "@shared/risk-engine";
import { SIMULATED_DATA_LABEL, DECISION_SUPPORT_DISCLAIMER } from "@shared/identity";
import { useToast } from "@/hooks/use-toast";
import {
  Flame, Info, AlertTriangle, CheckCircle2, Printer,
  Thermometer, Droplets, Wind, Trees, MapPin, Clock,
  Cpu, FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const VEG_LABELS: Record<number, string> = {
  0: "Muito seca",
  1: "Seca",
  2: "Moderada",
  3: "Úmida",
};
const VEG_VALUES: Record<number, string> = {
  0: "very_dry", 1: "dry", 2: "moderate", 3: "humid",
};
const QUALITY_LABELS: Record<number, string> = {
  0: "Ruim", 1: "Regular", 2: "Boa", 3: "Excelente",
};
const QUALITY_VALUES: Record<number, string> = {
  0: "poor", 1: "regular", 2: "good", 3: "excellent",
};

const OP_TYPES = [
  "Agroindústria", "Empresa florestal", "Energia", "Mineração",
  "Logística / ativos territoriais", "Outro",
];

interface FormState {
  areaName: string;
  operationType: string;
  municipality: string;
  state: string;
  latitude: string;
  longitude: string;
  temperature: string;
  humidity: string;
  windSpeed: string;
  recentRainfall: string;
  vegetationCondition: number;
  historicalOccurrences: string;
  nearbyHotspot: boolean;
  hotspotDistance: string;
  dataQuality: number;
}

const DEFAULT_FORM: FormState = {
  areaName: "", operationType: "", municipality: "", state: "",
  latitude: "", longitude: "",
  temperature: "", humidity: "", windSpeed: "", recentRainfall: "",
  vegetationCondition: 2, historicalOccurrences: "0",
  nearbyHotspot: false, hotspotDistance: "0", dataQuality: 2,
};

// Result type that mirrors the Python API response
interface AnalysisResult {
  score: number;
  level: RiskLevel;
  confidence: number;
  factors: Array<{
    name: string;
    contribution: number;
    description: string;
    weight: string;
    value: string;
  }>;
  recommendations: Array<{
    priority: "imediata" | "urgente" | "preventiva" | "monitoramento";
    action: string;
    rationale: string;
  }>;
  model_type: string;
  model_version: string;
  dataset_type: string;
  is_simulated: boolean;
  calculated_at: string;
}

function modelTypeLabel(modelType: string): string {
  if (modelType === "supervised-ml") return "Modelo supervisionado experimental (Scikit-learn)";
  if (modelType === "transparent-rule-engine-ts-fallback") return "Motor demonstrativo baseado em regras (TypeScript)";
  return "Motor demonstrativo baseado em regras";
}

function ScoreGauge({ score, level }: { score: number; level: RiskLevel }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = riskLevelColor(level);
  return (
    <div className="flex flex-col items-center">
      <svg width="140" height="140" viewBox="0 0 140 140" aria-label={`Score: ${score}/100`}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="#e5e7eb" strokeWidth="14" />
        <circle cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="14"
          strokeDasharray={`${dash} ${circ}`}
          strokeDashoffset={circ / 4}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s ease" }}
        />
        <text x="70" y="64" textAnchor="middle" fontSize="28" fontWeight="bold" fill={color}>{score}</text>
        <text x="70" y="82" textAnchor="middle" fontSize="11" fill="#6b7280">/100</text>
      </svg>
      <RiskBadge level={level} score={score} size="md" className="mt-1" />
    </div>
  );
}

export default function RiskAnalysis() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAnalysisTutorial, setShowAnalysisTutorial] = useState(false);
  const { toast } = useToast();

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function applyScenario(key: string) {
    const s = DEMO_SCENARIOS[key];
    if (!s) return;
    const i = s.input;
    setForm(f => ({
      ...f,
      temperature: String(i.temperature),
      humidity: String(i.humidity),
      windSpeed: String(i.windSpeed),
      recentRainfall: String(i.recentRainfall),
      vegetationCondition: i.vegetationCondition,
      nearbyHotspot: i.nearbyHotspot,
      hotspotDistance: String(i.hotspotDistance),
      historicalOccurrences: String(i.historicalOccurrences),
      dataQuality: i.dataQuality,
      areaName: f.areaName || `Área Demo — ${s.label}`,
    }));
    toast({ title: `Cenário "${s.label}" carregado`, description: "Preencha os demais campos e clique em Analisar." });
  }

  function buildApiPayload(): Record<string, unknown> | null {
    const temp = parseFloat(form.temperature);
    const hum  = parseFloat(form.humidity);
    const wind = parseFloat(form.windSpeed);
    const rain = parseFloat(form.recentRainfall);
    const hist = parseInt(form.historicalOccurrences, 10);
    const dist = parseFloat(form.hotspotDistance);

    const errs: string[] = [];
    if (isNaN(temp))                    errs.push("Temperatura é obrigatória.");
    if (isNaN(hum) || hum < 0 || hum > 100) errs.push("Umidade deve estar entre 0 e 100.");
    if (isNaN(wind) || wind < 0)        errs.push("Velocidade do vento inválida.");
    if (isNaN(rain) || rain < 0)        errs.push("Precipitação inválida.");

    if (errs.length > 0) { setErrors(errs); return null; }
    setErrors([]);

    return {
      temperature: temp,
      humidity: hum,
      wind_speed: wind,
      recent_rainfall: rain,
      vegetation_condition: VEG_VALUES[form.vegetationCondition] ?? "moderate",
      nearby_hotspot: form.nearbyHotspot,
      hotspot_distance: form.nearbyHotspot && !isNaN(dist) ? dist : null,
      historical_occurrences: isNaN(hist) ? 0 : hist,
      data_quality: QUALITY_VALUES[form.dataQuality] ?? "good",
    };
  }

  async function handleAnalyze() {
    const payload = buildApiPayload();
    if (!payload) return;
    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/python-risk-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message ?? `Erro ${res.status}`);
      }
      const data: AnalysisResult = await res.json();
      setResult(data);
      // Bring the result into view — on phones it is rendered below the form.
      setTimeout(() => document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e: any) {
      toast({ title: "Erro na análise", description: e.message, variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
    }
  }

  const priorityColor: Record<string, string> = {
    imediata: "text-red-700 bg-red-50 border-red-200",
    urgente: "text-orange-700 bg-orange-50 border-orange-200",
    preventiva: "text-amber-700 bg-amber-50 border-amber-200",
    monitoramento: "text-blue-700 bg-blue-50 border-blue-200",
  };

  return (
    <Layout>
      {showAnalysisTutorial && <AnalysisTutorial onClose={() => setShowAnalysisTutorial(false)} />}

      <header className="mb-8 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-foreground flex items-center gap-2">
            <Flame className="w-7 h-7 sm:w-8 sm:h-8 text-primary shrink-0" />
            Análise Preditiva de Risco
          </h1>
          <p className="text-muted-foreground mt-2 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 shrink-0" />
            {result
              ? modelTypeLabel(result.model_type)
              : "Motor de análise Python + Scikit-learn"}
            {result?.dataset_type === "synthetic" && (
              <span className="ml-1 text-xs bg-violet-50 text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded-full">
                dataset sintético
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowAnalysisTutorial(true)}
          className="shrink-0 self-start flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/60 text-sm text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
        >
          <Info className="w-4 h-4" />
          Como realizar uma análise?
        </button>
      </header>

      {/* Cenários demonstrativos */}
      <div className="mb-6">
        <p className="text-sm font-semibold text-muted-foreground mb-2">Carregar cenário demonstrativo:</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(DEMO_SCENARIOS).map(([key, s]) => (
            <Button key={key} variant="outline" size="sm" onClick={() => applyScenario(key)}>
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ── Formulário ────────────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Identificação */}
          <div className="bg-card border border-border/50 rounded-2xl p-6 space-y-4" data-tour="risk-form">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" /> Identificação da área
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Nome da área</label>
                <input className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={form.areaName} onChange={e => setField("areaName", e.target.value)}
                  placeholder="Ex.: Fazenda Santa Rosa" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipo de operação</label>
                <select className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={form.operationType} onChange={e => setField("operationType", e.target.value)}>
                  <option value="">Selecionar...</option>
                  {OP_TYPES.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Município</label>
                <input className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={form.municipality} onChange={e => setField("municipality", e.target.value)}
                  placeholder="Ex.: Alto Paraíso de Goiás" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Estado</label>
                <input className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={form.state} onChange={e => setField("state", e.target.value)}
                  placeholder="Ex.: GO" maxLength={2} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Latitude</label>
                <input type="number" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={form.latitude} onChange={e => setField("latitude", e.target.value)}
                  placeholder="-14.123" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Longitude</label>
                <input type="number" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={form.longitude} onChange={e => setField("longitude", e.target.value)}
                  placeholder="-47.512" />
              </div>
            </div>
          </div>

          {/* Dados ambientais */}
          <div className="bg-card border border-border/50 rounded-2xl p-6 space-y-4">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Thermometer className="w-4 h-4 text-primary" /> Dados ambientais <span className="text-xs text-red-500">*obrigatórios</span>
              <HelpTooltip text="Preencha com dados reais ou use um cenário demonstrativo. Temperatura, umidade, vento e precipitação são obrigatórios." />
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Temperatura (°C) *</label>
                <input type="number" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={form.temperature} onChange={e => setField("temperature", e.target.value)}
                  placeholder="Ex.: 38" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Umidade relativa (%) *</label>
                <input type="number" min="0" max="100" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={form.humidity} onChange={e => setField("humidity", e.target.value)}
                  placeholder="Ex.: 25" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Velocidade do vento (km/h) *</label>
                <input type="number" min="0" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={form.windSpeed} onChange={e => setField("windSpeed", e.target.value)}
                  placeholder="Ex.: 30" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Precipitação últimas 72h (mm) *</label>
                <input type="number" min="0" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={form.recentRainfall} onChange={e => setField("recentRainfall", e.target.value)}
                  placeholder="Ex.: 0" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Condição da vegetação</label>
                <select className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={form.vegetationCondition}
                  onChange={e => setField("vegetationCondition", Number(e.target.value) as 0|1|2|3)}>
                  {[0,1,2,3].map(v => <option key={v} value={v}>{VEG_LABELS[v]}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Ocorrências históricas</label>
                <input type="number" min="0" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={form.historicalOccurrences} onChange={e => setField("historicalOccurrences", e.target.value)}
                  placeholder="Ex.: 2" />
              </div>
            </div>

            {/* Foco próximo */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input type="checkbox" checked={form.nearbyHotspot}
                  onChange={e => setField("nearbyHotspot", e.target.checked)}
                  className="rounded" />
                Existe foco de incêndio próximo à área
              </label>
              {form.nearbyHotspot && (
                <div className="mt-2">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Distância estimada do foco (km)</label>
                  <input type="number" min="0" className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                    value={form.hotspotDistance} onChange={e => setField("hotspotDistance", e.target.value)}
                    placeholder="Ex.: 8" />
                </div>
              )}
            </div>

            {/* Qualidade dos dados */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Qualidade da fonte de dados</label>
              <select className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={form.dataQuality}
                onChange={e => setField("dataQuality", Number(e.target.value) as 0|1|2|3)}>
                {[0,1,2,3].map(v => <option key={v} value={v}>{QUALITY_LABELS[v]}</option>)}
              </select>
            </div>
          </div>

          {/* Errors */}
          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-red-700 mb-1">Corrija os erros antes de analisar:</p>
              <ul className="list-disc list-inside space-y-1">
                {errors.map((e, i) => <li key={i} className="text-sm text-red-600">{e}</li>)}
              </ul>
            </div>
          )}

          <Button onClick={handleAnalyze} disabled={isAnalyzing} size="lg" className="w-full font-bold">
            {isAnalyzing ? (
              <span className="flex items-center gap-2"><span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />Analisando...</span>
            ) : (
              <span className="flex items-center gap-2"><Flame className="w-5 h-5" />Analisar risco</span>
            )}
          </Button>

          <p className="text-xs text-muted-foreground text-center flex items-start gap-1">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {DECISION_SUPPORT_DISCLAIMER}
          </p>
        </div>

        {/* ── Resultado ─────────────────────────────────────────────────── */}
        {result ? (
          <div className="space-y-5 scroll-mt-20" id="result">
            {/* Score */}
            <div className="bg-card border border-border/50 rounded-2xl p-6" data-tour="risk-result">
              <div className="flex flex-col items-center gap-4 mb-5">
                <ScoreGauge score={result.score} level={result.level} />
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">{riskLevelDescription(result.level)}</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Confiança: {Math.round(result.confidence * 100)}% · v{result.model_version} ·{" "}
                    {format(new Date(result.calculated_at), "d 'de' MMM yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                  {/* Model type badge */}
                  <span className={cn(
                    "inline-flex items-center gap-1 mt-2 text-xs px-2 py-0.5 rounded-full border font-medium",
                    result.model_type === "supervised-ml"
                      ? "bg-violet-50 text-violet-700 border-violet-200"
                      : "bg-slate-50 text-slate-600 border-slate-200"
                  )}>
                    {result.model_type === "supervised-ml"
                      ? <><FlaskConical className="w-3 h-3" /> Modelo supervisionado experimental</>
                      : <><Cpu className="w-3 h-3" /> Motor demonstrativo baseado em regras</>
                    }
                  </span>
                  {result.is_simulated && (
                    <span className="inline-block mt-1 ml-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                      {SIMULATED_DATA_LABEL}
                    </span>
                  )}
                </div>
              </div>

              <Button variant="outline" size="sm" onClick={() => window.print()} className="w-full">
                <Printer className="w-4 h-4 mr-2" /> Imprimir relatório
              </Button>
            </div>

            {/* Fatores */}
            <div className="bg-card border border-border/50 rounded-2xl p-6" data-tour="risk-factors">
              <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" /> Fatores que influenciaram o risco
                <HelpTooltip text="Esta seção explica quais fatores aumentaram ou reduziram a pontuação, tornando o resultado mais transparente." />
              </h3>
              <div className="space-y-3">
                {result.factors.map((f, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-muted/30 rounded-xl">
                    <div className={cn(
                      "text-xs font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5",
                      f.contribution > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                    )}>
                      {f.contribution > 0 ? `+${f.contribution}` : f.contribution}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{f.name} <span className="text-muted-foreground font-normal">— {f.value}</span></p>
                      <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>
                    </div>
                    <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0",
                      f.weight === "alto" ? "bg-red-50 text-red-600" :
                      f.weight === "médio" ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-600"
                    )}>{f.weight}</span>
                  </div>
                ))}
                {result.factors.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhum fator de risco significativo identificado.</p>
                )}
              </div>
            </div>

            {/* Recomendações */}
            <div className="bg-card border border-border/50 rounded-2xl p-6">
              <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" /> Recomendações preventivas
              </h3>
              <div className="space-y-3">
                {result.recommendations.map((r, i) => (
                  <div key={i} className={cn("p-3 rounded-xl border text-sm", priorityColor[r.priority] ?? "text-slate-700 bg-slate-50 border-slate-200")}>
                    <p className="font-semibold capitalize mb-1">{r.priority}: {r.action}</p>
                    <p className="text-xs opacity-80">{r.rationale}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Aviso ML experimental */}
            {result.model_type === "supervised-ml" && (
              <div className="flex items-start gap-2 text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-xl p-3">
                <FlaskConical className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Resultado produzido por modelo supervisionado experimental treinado com dataset sintético.
                Métricas iniciais demonstram viabilidade técnica em ambiente controlado.
                Validação com dados reais prevista durante a Prova de Valor.
              </div>
            )}

            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-xl p-3">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {DECISION_SUPPORT_DISCLAIMER}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center bg-muted/20 border border-dashed border-border rounded-2xl p-12">
            <Flame className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="font-semibold text-muted-foreground">Resultado aparecerá aqui</p>
            <p className="text-sm text-muted-foreground/60 mt-2">Preencha os dados ao lado e clique em "Analisar risco"</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
