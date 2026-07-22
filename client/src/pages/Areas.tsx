import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { RiskBadge, riskLevelColor } from "@/components/RiskBadge";
import { useLocation } from "wouter";
import { SIMULATED_DATA_LABEL } from "@shared/identity";
import { calculateRisk, DEMO_SCENARIOS } from "@shared/risk-engine";
import {
  MapPinned, Plus, Flame, BarChart3, Clock, Filter, Search, Info
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

// Demo areas with pre-computed risk results
const DEMO_AREAS = Object.entries(DEMO_SCENARIOS).map(([key, s], i) => {
  const risk = calculateRisk(s.input, true);
  return {
    id: i + 1,
    name: `Área Demo ${i + 1} — ${s.label}`,
    operationType: ["Agroindústria", "Empresa florestal", "Energia", "Mineração"][i] ?? "Outro",
    municipality: ["Alto Paraíso", "Niquelândia", "Goiânia", "Crixás"][i] ?? "—",
    state: "GO",
    areaHectares: [1200, 850, 3500, 2100][i] ?? 1000,
    status: "ativo",
    latitude: [-14.12, -14.47, -16.68, -14.54][i] ?? -14,
    longitude: [-47.51, -48.46, -49.25, -50.26][i] ?? -47,
    lastAnalysis: new Date(Date.now() - i * 3600000 * 6),
    risk,
  };
});

type SortKey = "name" | "score" | "area";
type FilterLevel = "all" | "baixo" | "moderado" | "alto" | "crítico";

export default function Areas() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [filterLevel, setFilterLevel] = useState<FilterLevel>("all");
  const [sort, setSort] = useState<SortKey>("score");

  const filtered = DEMO_AREAS
    .filter(a => filterLevel === "all" || a.risk.level === filterLevel)
    .filter(a => !search || a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.municipality.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === "score") return b.risk.score - a.risk.score;
      if (sort === "area") return (b.areaHectares ?? 0) - (a.areaHectares ?? 0);
      return a.name.localeCompare(b.name);
    });

  const countByLevel = DEMO_AREAS.reduce((acc, a) => {
    acc[a.risk.level] = (acc[a.risk.level] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Layout>
      <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-foreground flex items-center gap-2">
            <MapPinned className="w-8 h-8 text-primary" />
            Áreas Monitoradas
          </h1>
          <p className="text-muted-foreground mt-1">
            {DEMO_AREAS.length} áreas cadastradas · <span className="text-amber-600">{SIMULATED_DATA_LABEL}</span>
          </p>
        </div>
        <Button onClick={() => setLocation("/simulacao")} className="flex items-center gap-2">
          <Plus className="w-4 h-4" /> Nova análise
        </Button>
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {(["baixo","moderado","alto","crítico"] as const).map(level => (
          <button
            key={level}
            onClick={() => setFilterLevel(filterLevel === level ? "all" : level)}
            className={cn(
              "rounded-2xl border p-4 text-left transition-all hover:shadow-md",
              filterLevel === level ? "ring-2 ring-primary bg-primary/5" : "bg-card border-border/50"
            )}
          >
            <RiskBadge level={level} size="sm" />
            <p className="text-2xl font-bold mt-2" style={{ color: riskLevelColor(level) }}>
              {countByLevel[level] ?? 0}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">áreas</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="Buscar por nome ou município..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <select
            className="px-3 py-2.5 text-sm border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
          >
            <option value="score">Ordenar: Maior risco</option>
            <option value="name">Ordenar: Nome</option>
            <option value="area">Ordenar: Maior área</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border/50 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30">
                <th className="px-5 py-3 text-left font-semibold text-muted-foreground">Área</th>
                <th className="px-5 py-3 text-left font-semibold text-muted-foreground">Operação</th>
                <th className="px-5 py-3 text-left font-semibold text-muted-foreground">Local</th>
                <th className="px-5 py-3 text-left font-semibold text-muted-foreground">Índice</th>
                <th className="px-5 py-3 text-left font-semibold text-muted-foreground">Área (ha)</th>
                <th className="px-5 py-3 text-left font-semibold text-muted-foreground">Última análise</th>
                <th className="px-5 py-3 text-left font-semibold text-muted-foreground">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((area, i) => (
                <tr key={area.id} className={cn("border-b border-border/30 hover:bg-muted/20 transition-colors", i === filtered.length - 1 && "border-0")}>
                  <td className="px-5 py-4 font-medium text-foreground">{area.name}</td>
                  <td className="px-5 py-4 text-muted-foreground">{area.operationType}</td>
                  <td className="px-5 py-4 text-muted-foreground">{area.municipality}/{area.state}</td>
                  <td className="px-5 py-4">
                    <RiskBadge level={area.risk.level} score={area.risk.score} size="sm" />
                  </td>
                  <td className="px-5 py-4 text-muted-foreground">{area.areaHectares?.toLocaleString("pt-BR")}</td>
                  <td className="px-5 py-4 text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {format(area.lastAnalysis, "d/MM HH:mm", { locale: ptBR })}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setLocation("/simulacao")}>
                        <Flame className="w-3.5 h-3.5 mr-1" /> Analisar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setLocation("/maps")}>
                        <BarChart3 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">
                  Nenhuma área encontrada.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-start gap-2 mt-4 text-xs text-muted-foreground">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        {SIMULATED_DATA_LABEL} As áreas, índices e análises exibidos são demonstrativos.
      </div>
    </Layout>
  );
}
