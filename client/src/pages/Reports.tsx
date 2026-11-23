import { useState } from "react";
import { Layout } from "@/components/Layout";
import { RiskBadge } from "@/components/RiskBadge";
import { calculateRisk, DEMO_SCENARIOS, type RiskResult } from "@shared/risk-engine";
import { SIMULATED_DATA_LABEL, DECISION_SUPPORT_DISCLAIMER, PRODUCT_NAME, TRL_LABEL, SUBMISSION_MODE } from "@shared/identity";
import { FileText, Download, Printer, Info, BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

const DEMO_RESULTS = Object.entries(DEMO_SCENARIOS).map(([key, s]) => ({
  key,
  label: s.label,
  areaName: `Área Demo — ${s.label}`,
  operationType: { baixo: "Agroindústria", moderado: "Empresa florestal", alto: "Energia", crítico: "Mineração" }[key] ?? "Outro",
  municipality: { baixo: "Alto Paraíso/GO", moderado: "Niquelândia/GO", alto: "Goiânia/GO", crítico: "Crixás/GO" }[key] ?? "—",
  input: s.input,
  result: calculateRisk(s.input, true),
}));

function AnalysisReport({ item }: { item: typeof DEMO_RESULTS[0] }) {
  const [expanded, setExpanded] = useState(false);
  const r = item.result;
  const now = format(new Date(r.calculatedAt), "d 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR });

  return (
    <div className="bg-card border border-border/50 rounded-2xl shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-5 hover:bg-muted/20 transition-colors text-left"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-4">
          <RiskBadge level={r.level} score={r.score} size="md" />
          <div>
            <p className="font-semibold text-foreground">{item.areaName}</p>
            <p className="text-xs text-muted-foreground">{item.operationType} · {item.municipality}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground hidden sm:block">{now}</span>
          {expanded ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/30 p-6 space-y-6">
          {/* Header */}
          <div className="bg-muted/30 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-muted-foreground">Plataforma</p>
                <p className="font-semibold text-foreground">
                  {SUBMISSION_MODE ? "Plataforma Preditiva de Inteligência Ambiental" : PRODUCT_NAME}
                </p>
              </div>
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-full font-medium">
                {TRL_LABEL}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Área</p><p className="font-medium">{item.areaName}</p></div>
              <div><p className="text-xs text-muted-foreground">Operação</p><p className="font-medium">{item.operationType}</p></div>
              <div><p className="text-xs text-muted-foreground">Local</p><p className="font-medium">{item.municipality}</p></div>
              <div><p className="text-xs text-muted-foreground">Data</p><p className="font-medium">{now}</p></div>
            </div>
          </div>

          {/* Score */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-card border border-border/40 rounded-xl p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Índice de Risco</p>
              <p className="text-4xl font-bold text-foreground">{r.score}</p>
              <p className="text-xs text-muted-foreground">/100</p>
              <RiskBadge level={r.level} size="sm" className="mt-2" />
            </div>
            <div className="bg-card border border-border/40 rounded-xl p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Confiança</p>
              <p className="text-4xl font-bold text-foreground">{Math.round(r.confidence * 100)}%</p>
              <p className="text-xs text-muted-foreground mt-1">baseado na qualidade dos dados</p>
            </div>
            <div className="bg-card border border-border/40 rounded-xl p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Motor</p>
              <p className="text-xl font-bold text-foreground">v{r.calculationVersion}</p>
              <p className="text-xs text-muted-foreground mt-1">Baseado em regras documentadas</p>
            </div>
          </div>

          {/* Inputs */}
          <div>
            <h3 className="font-semibold text-foreground mb-3 text-sm">Dados de entrada</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {[
                { label: "Temperatura", value: `${item.input.temperature}°C` },
                { label: "Umidade", value: `${item.input.humidity}%` },
                { label: "Vento", value: `${item.input.windSpeed} km/h` },
                { label: "Precipitação 72h", value: `${item.input.recentRainfall} mm` },
                { label: "Vegetação", value: ["Muito seca","Seca","Moderada","Úmida"][item.input.vegetationCondition] },
                { label: "Foco próximo", value: item.input.nearbyHotspot ? `Sim (${item.input.hotspotDistance} km)` : "Não" },
                { label: "Histórico", value: `${item.input.historicalOccurrences} ocorrências` },
                { label: "Qualidade dos dados", value: ["Ruim","Regular","Boa","Excelente"][item.input.dataQuality] },
              ].map(d => (
                <div key={d.label} className="bg-muted/20 rounded-lg p-2.5">
                  <p className="text-muted-foreground">{d.label}</p>
                  <p className="font-semibold text-foreground mt-0.5">{d.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Factors */}
          <div>
            <h3 className="font-semibold text-foreground mb-3 text-sm">Fatores identificados</h3>
            <div className="space-y-2">
              {r.factors.map((f, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-muted/20 rounded-lg text-sm">
                  <span className={cn("font-bold shrink-0 min-w-[32px] text-xs", f.contribution > 0 ? "text-red-600" : "text-green-600")}>
                    {f.contribution > 0 ? `+${f.contribution}` : f.contribution}
                  </span>
                  <div>
                    <p className="font-medium text-foreground">{f.name} — <span className="text-muted-foreground font-normal">{f.value}</span></p>
                    <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>
                  </div>
                </div>
              ))}
              {r.factors.length === 0 && <p className="text-sm text-muted-foreground">Nenhum fator de risco significativo.</p>}
            </div>
          </div>

          {/* Recommendations */}
          <div>
            <h3 className="font-semibold text-foreground mb-3 text-sm">Recomendações</h3>
            <div className="space-y-2">
              {r.recommendations.slice(0, 4).map((rec, i) => (
                <div key={i} className="flex items-start gap-2 text-sm p-3 bg-muted/20 rounded-lg">
                  <span className="font-bold text-primary shrink-0 mt-0.5 capitalize text-xs">{rec.priority}:</span>
                  <span className="text-muted-foreground">{rec.action}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Simulated data notice + disclaimer */}
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {SIMULATED_DATA_LABEL}
            </div>
            <div className="bg-muted/30 border border-border/30 rounded-xl p-3 text-xs text-muted-foreground flex items-start gap-2">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {DECISION_SUPPORT_DISCLAIMER}
            </div>
            <div className="border border-dashed border-border/50 rounded-xl p-3 text-xs text-muted-foreground">
              <p className="font-semibold mb-1">Espaço para validação técnica:</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="border-b border-dashed border-border/40 pb-1">Validado por: ___________________</div>
                <div className="border-b border-dashed border-border/40 pb-1">Data: ___________________</div>
                <div className="border-b border-dashed border-border/40 pb-1">Cargo: ___________________</div>
                <div className="border-b border-dashed border-border/40 pb-1">Assinatura: ___________________</div>
              </div>
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={() => window.print()} className="w-full">
            <Printer className="w-4 h-4 mr-2" /> Imprimir relatório
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  const [showComparative, setShowComparative] = useState(false);

  const totals = {
    analyses: DEMO_RESULTS.length,
    critical: DEMO_RESULTS.filter(r => r.result.level === "crítico").length,
    high: DEMO_RESULTS.filter(r => r.result.level === "alto").length,
    avgScore: Math.round(DEMO_RESULTS.reduce((s, r) => s + r.result.score, 0) / DEMO_RESULTS.length),
  };

  return (
    <Layout>
      <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-foreground flex items-center gap-2">
            <FileText className="w-8 h-8 text-primary" />
            Relatórios
          </h1>
          <p className="text-muted-foreground mt-1">
            {DEMO_RESULTS.length} análises demonstrativas · <span className="text-amber-600 text-sm">{SIMULATED_DATA_LABEL}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-2" /> Imprimir
          </Button>
        </div>
      </header>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-card border border-border/50 rounded-2xl p-4 shadow-sm text-center">
          <p className="text-3xl font-bold text-foreground">{totals.analyses}</p>
          <p className="text-xs text-muted-foreground mt-1">Análises realizadas</p>
        </div>
        <div className="bg-card border border-border/50 rounded-2xl p-4 shadow-sm text-center">
          <p className="text-3xl font-bold text-red-600">{totals.critical}</p>
          <p className="text-xs text-muted-foreground mt-1">Risco crítico</p>
        </div>
        <div className="bg-card border border-border/50 rounded-2xl p-4 shadow-sm text-center">
          <p className="text-3xl font-bold text-orange-600">{totals.high}</p>
          <p className="text-xs text-muted-foreground mt-1">Risco alto</p>
        </div>
        <div className="bg-card border border-border/50 rounded-2xl p-4 shadow-sm text-center">
          <p className="text-3xl font-bold text-foreground">{totals.avgScore}</p>
          <p className="text-xs text-muted-foreground mt-1">Score médio /100</p>
        </div>
      </div>

      {/* Relatório comparativo */}
      <div className="bg-card border border-border/50 rounded-2xl shadow-sm mb-6 overflow-hidden">
        <button
          className="w-full flex items-center justify-between p-5 hover:bg-muted/20 transition-colors"
          onClick={() => setShowComparative(e => !e)}
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            <span className="font-semibold text-foreground">Relatório Comparativo — 4 cenários demonstrativos</span>
          </div>
          {showComparative ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
        </button>
        {showComparative && (
          <div className="border-t border-border/30 p-6">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="pb-3 text-left text-xs font-semibold text-muted-foreground">Cenário</th>
                    <th className="pb-3 text-left text-xs font-semibold text-muted-foreground">Índice</th>
                    <th className="pb-3 text-left text-xs font-semibold text-muted-foreground">Nível</th>
                    <th className="pb-3 text-left text-xs font-semibold text-muted-foreground">Fatores</th>
                    <th className="pb-3 text-left text-xs font-semibold text-muted-foreground">Confiança</th>
                    <th className="pb-3 text-left text-xs font-semibold text-muted-foreground">Recomendações</th>
                  </tr>
                </thead>
                <tbody>
                  {DEMO_RESULTS.map(r => (
                    <tr key={r.key} className="border-b border-border/20 last:border-0">
                      <td className="py-3 font-medium text-foreground">{r.label}</td>
                      <td className="py-3 font-bold text-foreground">{r.result.score}</td>
                      <td className="py-3"><RiskBadge level={r.result.level} size="sm" /></td>
                      <td className="py-3 text-muted-foreground">{r.result.factors.length} fator(es)</td>
                      <td className="py-3 text-muted-foreground">{Math.round(r.result.confidence * 100)}%</td>
                      <td className="py-3 text-muted-foreground">{r.result.recommendations.length} rec.</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-amber-600 mt-4">{SIMULATED_DATA_LABEL}</p>
          </div>
        )}
      </div>

      {/* Individual reports */}
      <div className="space-y-4">
        <h2 className="font-semibold text-foreground">Relatórios individuais de análise</h2>
        {DEMO_RESULTS.map(item => (
          <AnalysisReport key={item.key} item={item} />
        ))}
      </div>

      <div className="flex items-start gap-2 mt-6 text-xs text-muted-foreground">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        Exportação CSV/PDF: funcionalidade demonstrativa. Utilize o botão "Imprimir" para salvar como PDF via diálogo do navegador.
      </div>
    </Layout>
  );
}
