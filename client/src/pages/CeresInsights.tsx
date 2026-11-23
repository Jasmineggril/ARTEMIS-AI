import { Layout } from "@/components/Layout";
import { RiskBadge } from "@/components/RiskBadge";
import { SIMULATED_DATA_LABEL } from "@shared/identity";
import { BarChart3, Info, TrendingUp, Clock, CheckCircle2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend
} from "recharts";

const RISK_COLORS: Record<string, string> = {
  baixo: "#16a34a",
  moderado: "#d97706",
  alto: "#ea580c",
  crítico: "#dc2626",
};

const ANALYSES_PER_PERIOD = [
  { period: "Semana 1", total: 12, baixo: 5, moderado: 3, alto: 2, crítico: 2 },
  { period: "Semana 2", total: 18, baixo: 6, moderado: 4, alto: 5, crítico: 3 },
  { period: "Semana 3", total: 22, baixo: 7, moderado: 6, alto: 5, crítico: 4 },
  { period: "Semana 4", total: 28, baixo: 8, moderado: 7, alto: 7, crítico: 6 },
];

const DISTRIBUTION = [
  { name: "Baixo", value: 26, color: RISK_COLORS.baixo },
  { name: "Moderado", value: 20, color: RISK_COLORS.moderado },
  { name: "Alto", value: 19, color: RISK_COLORS.alto },
  { name: "Crítico", value: 15, color: RISK_COLORS.crítico },
];

const EVOLUTION = [
  { time: "Jan", score: 42 },
  { time: "Fev", score: 38 },
  { time: "Mar", score: 51 },
  { time: "Abr", score: 63 },
  { time: "Mai", score: 71 },
  { time: "Jun", score: 68 },
  { time: "Jul", score: 55 },
];

const FREQUENT_FACTORS = [
  { factor: "Temperatura alta", count: 38 },
  { factor: "Umidade baixa", count: 35 },
  { factor: "Vegetação seca", count: 29 },
  { factor: "Vento forte", count: 22 },
  { factor: "Foco próximo", count: 18 },
  { factor: "Histórico de focos", count: 15 },
];

const ALERTS_DATA = [
  { period: "Sem 1", emitidos: 8, validados: 5 },
  { period: "Sem 2", emitidos: 12, validados: 8 },
  { period: "Sem 3", emitidos: 15, validados: 10 },
  { period: "Sem 4", emitidos: 19, validados: 13 },
];

const SOURCES_STATUS = [
  { name: "Open-Meteo API", type: "API ambiental", status: "ativo", quality: 95 },
  { name: "Dados climáticos históricos", type: "Base histórica", status: "simulado", quality: 80 },
  { name: "Estações de campo", type: "Estação climática", status: "simulado", quality: 70 },
  { name: "Mapa de vegetação", type: "Base geográfica", status: "simulado", quality: 75 },
];

const KPI_CARDS = [
  { label: "Total de análises", value: "80", desc: "últimas 4 semanas", icon: BarChart3, trend: "+40%" },
  { label: "Tempo médio de análise", value: "< 2s", desc: "motor v1.0.0", icon: Clock, trend: "meta: ≥30% redução" },
  { label: "Alertas emitidos", value: "54", desc: "últimas 4 semanas", icon: TrendingUp, trend: "↑ 37%" },
  { label: "Taxa de validação", value: "68%", desc: "meta prevista: ≥80%", icon: CheckCircle2, trend: "a validar na PoV" },
];

export default function CeresInsights() {
  return (
    <Layout>
      <header className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold font-display text-foreground flex items-center gap-2">
          <BarChart3 className="w-8 h-8 text-primary" />
          Inteligência Operacional
        </h1>
        <p className="text-muted-foreground mt-1 flex items-center gap-2">
          <Info className="w-4 h-4" />
          {SIMULATED_DATA_LABEL} Dados demonstrativos para validação do fluxo tecnológico.
        </p>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {KPI_CARDS.map(k => (
          <div key={k.label} className="bg-card border border-border/50 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <k.icon className="w-4 h-4 text-primary" />
              <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
            </div>
            <p className="text-3xl font-bold text-foreground">{k.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{k.desc}</p>
            <p className="text-xs text-primary font-semibold mt-1">{k.trend}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Análises por período */}
        <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-foreground mb-4 text-sm">Análises por período</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ANALYSES_PER_PERIOD} margin={{ left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="baixo" name="Baixo" stackId="a" fill={RISK_COLORS.baixo} />
              <Bar dataKey="moderado" name="Moderado" stackId="a" fill={RISK_COLORS.moderado} />
              <Bar dataKey="alto" name="Alto" stackId="a" fill={RISK_COLORS.alto} />
              <Bar dataKey="crítico" name="Crítico" stackId="a" fill={RISK_COLORS.crítico} radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Distribuição por nível */}
        <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-foreground mb-4 text-sm">Distribuição por nível de risco</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={DISTRIBUTION} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                {DISTRIBUTION.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Evolução do risco */}
        <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-foreground mb-4 text-sm">Evolução do índice médio de risco</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={EVOLUTION} margin={{ left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [`${v}/100`, "Score médio"]} />
              <Line type="monotone" dataKey="score" stroke="#0F5132" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Fatores críticos mais frequentes */}
        <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-foreground mb-4 text-sm">Fatores críticos mais frequentes</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={FREQUENT_FACTORS} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="factor" type="category" tick={{ fontSize: 10 }} width={130} />
              <Tooltip />
              <Bar dataKey="count" name="Ocorrências" fill="#0F5132" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Alertas emitidos vs validados */}
        <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-foreground mb-4 text-sm">Alertas emitidos vs validados</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ALERTS_DATA} margin={{ left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="emitidos" name="Emitidos" fill="#0F5132" />
              <Bar dataKey="validados" name="Validados" fill="#C9A227" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-amber-600 mt-2">Meta prevista: ≥80% de validação (a ser validado na PoV)</p>
        </div>

        {/* Fontes por status */}
        <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-foreground mb-4 text-sm">Fontes de dados por status</h2>
          <div className="space-y-3">
            {SOURCES_STATUS.map(s => (
              <div key={s.name} className="flex items-center gap-3 p-3 bg-muted/20 rounded-xl">
                <div className={`w-2 h-2 rounded-full shrink-0 ${s.status === "ativo" ? "bg-green-500" : "bg-amber-400"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.type}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-semibold text-foreground">{s.quality}%</p>
                  <p className="text-xs text-muted-foreground capitalize">{s.status}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-xl p-4">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        {SIMULATED_DATA_LABEL} Todos os gráficos utilizam dados demonstrativos para validação do fluxo tecnológico em TRL 4.
        Os resultados reais serão obtidos durante a Prova de Valor.
      </div>
    </Layout>
  );
}
