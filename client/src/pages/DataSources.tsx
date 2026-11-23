import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import {
  Database, Wifi, WifiOff, Clock, CheckCircle2, AlertTriangle,
  Radio, FileText, Upload, Globe, Cpu, Pencil, Info
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SIMULATED_DATA_LABEL } from "@shared/identity";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DataSource {
  id: number;
  name: string;
  type: string;
  status: string;
  isSimulated: boolean;
  lastUpdate: string | null;
  quality: number | null;
  description: string | null;
}

interface ImportBatch {
  id: number;
  filename: string;
  sourceName: string;
  sourceType: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  importedAt: string;
  status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "estação climática": Radio,
  "sensor IoT":        Cpu,
  "API ambiental":     Globe,
  "base histórica":    Database,
  "base geográfica":   Globe,
  "arquivo importado": FileText,
  "entrada manual":    Pencil,
  "simulação":         Cpu,
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  ativo:          { label: "Ativo",          color: "bg-green-100 text-green-800",   icon: CheckCircle2 },
  simulado:       { label: "Simulado",       color: "bg-blue-100 text-blue-800",     icon: Info },
  "em integração":{ label: "Em integração",  color: "bg-yellow-100 text-yellow-800", icon: AlertTriangle },
  indisponível:   { label: "Indisponível",   color: "bg-red-100 text-red-800",       icon: WifiOff },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG["simulado"];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", cfg.color)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function QualityBar({ quality }: { quality: number | null }) {
  if (quality == null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.round(quality * 100);
  const color = pct >= 80 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-secondary overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-medium" style={{ color }}>{pct}%</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DataSources() {
  const { data: sources = [], isLoading: loadingSources } = useQuery<DataSource[]>({
    queryKey: ["/api/data-sources"],
    queryFn: async () => {
      const res = await fetch("/api/data-sources");
      if (!res.ok) throw new Error("Falha ao carregar fontes de dados");
      return res.json();
    },
  });

  const { data: batches = [], isLoading: loadingBatches } = useQuery<ImportBatch[]>({
    queryKey: ["/api/import-batches"],
    queryFn: async () => {
      const res = await fetch("/api/import-batches");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const isLoading = loadingSources || loadingBatches;

  // Aggregate batches as additional "arquivo importado" sources
  const batchSources: DataSource[] = batches.map(b => ({
    id: -b.id,
    name: b.filename,
    type: "arquivo importado",
    status: "ativo",
    isSimulated: false,
    lastUpdate: b.importedAt,
    quality: b.totalRows > 0 ? b.validRows / b.totalRows : null,
    description: `${b.validRows}/${b.totalRows} registros válidos · Fonte: ${b.sourceName}`,
  }));

  const allSources = [...sources, ...batchSources];

  const statuses = ["ativo", "simulado", "em integração", "indisponível"];
  const statusCounts = statuses.map(s => ({
    label: STATUS_CONFIG[s]?.label ?? s,
    count: allSources.filter(x => x.status === s).length,
    color: STATUS_CONFIG[s]?.color ?? "",
  }));

  return (
    <Layout>
      {/* Header */}
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-1">Gestão de fontes</p>
        <h1 className="text-2xl sm:text-3xl font-bold font-display text-foreground flex items-center gap-2">
          <Database className="w-7 h-7 text-primary" />
          Fontes de Dados
        </h1>
        <p className="text-muted-foreground mt-1 text-sm flex items-center gap-1">
          <Info className="w-4 h-4" />
          {SIMULATED_DATA_LABEL} Fontes demonstrativas para validação do fluxo tecnológico.
        </p>
      </header>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {statusCounts.map(s => (
          <div key={s.label} className="bg-card border border-border/50 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{s.count}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Sources grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-card border border-border/50 rounded-xl p-5 h-36 animate-pulse" />
          ))}
        </div>
      ) : allSources.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Database className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Nenhuma fonte de dados cadastrada</p>
          <p className="text-sm mt-1">Importe ocorrências para criar uma fonte de arquivo.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {allSources.map(source => {
            const Icon = TYPE_ICONS[source.type] ?? Database;
            return (
              <div key={source.id} className="bg-card border border-border/50 rounded-xl p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground text-sm leading-tight">{source.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{source.type}</p>
                    </div>
                  </div>
                  <StatusBadge status={source.status} />
                </div>

                {source.description && (
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{source.description}</p>
                )}

                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Qualidade dos dados</span>
                    <QualityBar quality={source.quality} />
                  </div>
                  {source.lastUpdate && (
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>Atualizado em {new Date(source.lastUpdate).toLocaleDateString("pt-BR")}</span>
                    </div>
                  )}
                  {source.isSimulated && (
                    <div className="flex items-center gap-1 text-blue-600">
                      <Info className="w-3 h-3" />
                      <span>Dado demonstrativo</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Import CTA */}
      <div className="mt-8 p-5 bg-primary/5 border border-primary/20 rounded-xl flex items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-foreground text-sm">Importar novas ocorrências</p>
          <p className="text-xs text-muted-foreground mt-0.5">Adicione registros de arquivos CSV, XLS ou XLSX para enriquecer a análise.</p>
        </div>
        <a href="/data-import" className="shrink-0 inline-flex items-center gap-2 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors">
          <Upload className="w-4 h-4" /> Importar
        </a>
      </div>

      {/* Disclaimer */}
      <div className="mt-4 text-xs text-muted-foreground flex items-start gap-1.5">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
        <span>
          As fontes marcadas como "Simulado" utilizam dados demonstrativos gerados em ambiente controlado.
          A integração com fontes externas reais será implementada durante a Prova de Valor.
        </span>
      </div>
    </Layout>
  );
}
