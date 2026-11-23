import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { StatCard } from "@/components/StatCard";
import { RiskBadge } from "@/components/RiskBadge";
import { useSensors } from "@/hooks/use-sensors";
import { useAlerts } from "@/hooks/use-alerts";
import { useToast } from "@/hooks/use-toast";
import { calculateRisk, DEMO_SCENARIOS, type RiskResult } from "@shared/risk-engine";
import { SIMULATED_DATA_LABEL, DECISION_SUPPORT_DISCLAIMER } from "@shared/identity";
import {
  Activity, AlertTriangle, Database, Clock,
  MapPin, FileText, TrendingUp, BarChart3, Info, Flame
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend
} from "recharts";

// Pre-computed demo risk results for the 4 scenarios
const DEMO_RISK_RESULTS: RiskResult[] = Object.values(DEMO_SCENARIOS).map(s =>
  calculateRisk(s.input, true)
);

// Simulated weekly trend data
const TREND_DATA = [
  { day: "Seg", baixo: 5, moderado: 3, alto: 1, crítico: 0 },
  { day: "Ter", baixo: 4, moderado: 4, alto: 2, crítico: 0 },
  { day: "Qua", baixo: 3, moderado: 3, alto: 3, crítico: 1 },
  { day: "Qui", baixo: 3, moderado: 4, alto: 2, crítico: 1 },
  { day: "Sex", baixo: 2, moderado: 3, alto: 4, crítico: 2 },
  { day: "Sáb", baixo: 4, moderado: 2, alto: 2, crítico: 1 },
  { day: "Dom", baixo: 4, moderado: 3, alto: 2, crítico: 0 },
];

// Average risk score over time (simulated)
const SCORE_TREND = [
  { time: "00:00", score: 38 },
  { time: "04:00", score: 32 },
  { time: "08:00", score: 45 },
  { time: "10:00", score: 58 },
  { time: "12:00", score: 72 },
  { time: "14:00", score: 79 },
  { time: "16:00", score: 65 },
  { time: "18:00", score: 51 },
  { time: "20:00", score: 42 },
];

// Priority areas table data
const PRIORITY_AREAS = [
  {
    name: "Área Demo 4 — Cenário Crítico",
    sector: "Mineração",
    score: DEMO_RISK_RESULTS[3]?.score ?? 90,
    level: DEMO_RISK_RESULTS[3]?.level ?? "crítico",
    criticalFactors: "Temp. extrema, Umidade muito baixa, Foco próximo",
    lastAnalysis: "há 2h",
  },
  {
    name: "Área Demo 3 — Cenário Alto",
    sector: "Energia",
    score: DEMO_RISK_RESULTS[2]?.score ?? 65,
    level: DEMO_RISK_RESULTS[2]?.level ?? "alto",
    criticalFactors: "Temperatura alta, Vegetação seca, Histórico",
    lastAnalysis: "há 4h",
  },
  {
    name: "Área Demo 2 — Cenário Moderado",
    sector: "Empresa florestal",
    score: DEMO_RISK_RESULTS[1]?.score ?? 38,
    level: DEMO_RISK_RESULTS[1]?.level ?? "moderado",
    criticalFactors: "Temp. elevada, Umidade baixa",
    lastAnalysis: "há 6h",
  },
  {
    name: "Área Demo 1 — Cenário Baixo",
    sector: "Agroindústria",
    score: DEMO_RISK_RESULTS[0]?.score ?? 12,
    level: DEMO_RISK_RESULTS[0]?.level ?? "baixo",
    criticalFactors: "Nenhum fator crítico",
    lastAnalysis: "há 8h",
  },
];

const RECOMMENDATIONS_BY_LEVEL: Record<string, string[]> = {
  crítico: [
    "Acionar brigada imediatamente.",
    "Suspender atividades produtivas.",
    "Comunicar Bombeiros e Defesa Civil.",
    "Evacuar áreas vulneráveis.",
  ],
  alto: [
    "Acionar protocolo de prontidão.",
    "Restringir atividades com faíscas.",
    "Verificar equipamentos de combate.",
    "Alertar equipes e gestores.",
  ],
  moderado: [
    "Intensificar monitoramento de campo.",
    "Reforçar aceiros nas zonas críticas.",
    "Alertar equipes locais.",
  ],
  baixo: [
    "Manter monitoramento periódico.",
    "Verificar aceiros e equipamentos.",
    "Registrar condições observadas.",
  ],
};

const RISK_COLORS: Record<string, string> = {
  baixo: "#16a34a",
  moderado: "#d97706",
  alto: "#ea580c",
  crítico: "#dc2626",
};

export default function Dashboard() {
  const { data: sensors } = useSensors();
  const { data: alerts } = useAlerts();
  const { toast } = useToast();

  const criticalAlerts = alerts?.filter(a => a.severity === "critical" && !a.isResolved).length ?? 0;
  const activeSensors = sensors?.filter(s => s.status === "active").length ?? 0;

  // Derive current dominant risk from demo data
  const criticalAreas = DEMO_RISK_RESULTS.filter(r => r.level === "crítico").length;
  const avgScore = Math.round(DEMO_RISK_RESULTS.reduce((s, r) => s + r.score, 0) / DEMO_RISK_RESULTS.length);

  const dominantResult = DEMO_RISK_RESULTS.reduce((a, b) => a.score > b.score ? a : b);

  useEffect(() => {
    if (!alerts) return;
    const critical = alerts.find(a => a.severity === "critical" && !a.isResolved);
    if (critical) {
      toast({ title: critical.title, description: critical.message, variant: "destructive" });
    }
  }, [alerts, toast]);

  const recommendations = RECOMMENDATIONS_BY_LEVEL[dominantResult?.level ?? "baixo"] ?? [];

  return (
    <Layout>
      <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-foreground">Visão Geral</h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Atualizado às {format(new Date(), "HH:mm", { locale: ptBR })} ·{" "}
            <span className="text-amber-600 text-sm">{SIMULATED_DATA_LABEL}</span>
          </p>
        </div>
        <Link href="/reports">
          <button className="bg-primary hover:bg-primary/90 text-white px-5 py-2.5 rounded-xl font-semibold transition-all flex items-center gap-2 shadow-sm text-sm whitespace-nowrap">
            <FileText className="w-4 h-4" /> Gerar relatório
          </button>
        </Link>
      </header>

      {/* ── KPI Cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8" data-tour="dashboard-summary">
        <StatCard title="Áreas monitoradas" value="4" icon={<MapPin className="w-5 h-5" />} trend="Demo" trendUp={false} />
        <StatCard title="Índice médio de risco" value={String(avgScore)} icon={<Flame className="w-5 h-5" />} trend="0–100" trendUp={avgScore > 50} />
        <StatCard title="Alertas ativos" value={String(criticalAlerts)} icon={<AlertTriangle className="w-5 h-5" />} trend={`${alerts?.length ?? 0} total`} trendUp={criticalAlerts > 0} />
        <StatCard title="Fontes de dados" value={String(activeSensors || 3)} icon={<Database className="w-5 h-5" />} trend="Online" trendUp={true} />
      </div>

      {/* ── Índice de Risco Central ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="md:col-span-2 bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" /> Índice de Risco de Incêndio — Área Crítica
          </h2>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
            <div className="text-center">
              <p className="text-6xl font-bold" style={{ color: RISK_COLORS[dominantResult?.level ?? "baixo"] }}>
                {dominantResult?.score ?? 0}
              </p>
              <p className="text-sm text-muted-foreground">/100</p>
              <RiskBadge level={dominantResult?.level ?? "baixo"} size="md" className="mt-2" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-muted/30 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground">Área analisada</p>
                  <p className="font-semibold">Área Demo 4</p>
                </div>
                <div className="bg-muted/30 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground">Motor</p>
                  <p className="font-semibold">v{dominantResult?.calculationVersion}</p>
                </div>
                <div className="bg-muted/30 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground">Confiança</p>
                  <p className="font-semibold">{Math.round((dominantResult?.confidence ?? 0) * 100)}%</p>
                </div>
                <div className="bg-muted/30 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground">Status dos dados</p>
                  <p className="font-semibold text-amber-600 text-xs">Simulados</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="w-3.5 h-3.5" /> {DECISION_SUPPORT_DISCLAIMER}
              </p>
            </div>
          </div>
        </div>

        {/* Recomendações */}
        <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-foreground mb-3 text-sm">Recomendações preventivas</h2>
          <ol className="space-y-2">
            {recommendations.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="font-bold text-primary shrink-0 mt-0.5">{i + 1}.</span>
                {r}
              </li>
            ))}
          </ol>
          <Link href="/prevention">
            <button className="mt-4 text-xs text-primary font-semibold hover:underline">
              Ver protocolo completo →
            </button>
          </Link>
        </div>
      </div>

      {/* ── Fatores de Risco ─────────────────────────────────────────────── */}
      <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm mb-8">
        <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" /> Fatores que influenciaram o risco
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {(dominantResult?.factors ?? []).slice(0, 8).map((f, i) => (
            <div key={i} className="bg-muted/30 rounded-xl p-3 border border-border/30">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-semibold text-foreground truncate">{f.name}</p>
                <span className={`text-xs font-bold ${f.contribution > 0 ? "text-red-600" : "text-green-600"}`}>
                  {f.contribution > 0 ? `+${f.contribution}` : f.contribution}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{f.value}</p>
            </div>
          ))}
          {(dominantResult?.factors?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground col-span-4">Nenhum fator de risco significativo identificado.</p>
          )}
        </div>
      </div>

      {/* ── Charts ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Score ao longo do dia */}
        <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-foreground mb-4 text-sm">Evolução do índice de risco (hoje)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={SCORE_TREND} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [`${v}/100`, "Score"]} />
              <Line type="monotone" dataKey="score" stroke="#0F5132" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted-foreground mt-2 text-center">{SIMULATED_DATA_LABEL}</p>
        </div>

        {/* Distribuição por nível */}
        <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-foreground mb-4 text-sm">Análises por nível de risco (semana)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={TREND_DATA} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="baixo" name="Baixo" stackId="a" fill={RISK_COLORS.baixo} />
              <Bar dataKey="moderado" name="Moderado" stackId="a" fill={RISK_COLORS.moderado} />
              <Bar dataKey="alto" name="Alto" stackId="a" fill={RISK_COLORS.alto} />
              <Bar dataKey="crítico" name="Crítico" stackId="a" fill={RISK_COLORS.crítico} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted-foreground mt-2 text-center">{SIMULATED_DATA_LABEL}</p>
        </div>
      </div>

      {/* ── Áreas prioritárias ───────────────────────────────────────────── */}
      <div className="bg-card border border-border/50 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border/30 flex items-center justify-between">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" /> Áreas prioritárias
          </h2>
          <Link href="/areas">
            <button className="text-xs text-primary font-semibold hover:underline">Ver todas →</button>
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border/30">
                <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">Área</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">Setor</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">Índice</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">Fatores críticos</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">Última análise</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">Ação</th>
              </tr>
            </thead>
            <tbody>
              {PRIORITY_AREAS.map((area, i) => (
                <tr key={i} className="border-b border-border/20 hover:bg-muted/10 transition-colors last:border-0">
                  <td className="px-5 py-3 font-medium text-foreground">{area.name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{area.sector}</td>
                  <td className="px-5 py-3"><RiskBadge level={area.level} score={area.score} size="sm" /></td>
                  <td className="px-5 py-3 text-muted-foreground text-xs max-w-[200px]">{area.criticalFactors}</td>
                  <td className="px-5 py-3 text-muted-foreground text-xs">{area.lastAnalysis}</td>
                  <td className="px-5 py-3">
                    <Link href="/simulacao">
                      <button className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
                        <Flame className="w-3.5 h-3.5" /> Analisar
                      </button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
