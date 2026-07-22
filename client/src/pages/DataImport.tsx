import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, FileText, AlertTriangle, CheckCircle2, XCircle,
  Info, Download, ChevronRight, ChevronDown, Table,
  MapPin, Calendar, Loader2, RotateCcw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  [key: string]: string;
}

interface ValidationRecord {
  index: number;
  status: "válido" | "válido com ressalvas" | "inválido" | "duplicado";
  row: ParsedRow;
  issues: string[];
  mapped: {
    occurrenceDate?: string;
    occurrenceTime?: string;
    municipality?: string;
    state?: string;
    latitude?: number;
    longitude?: number;
    occurrenceType?: string;
    occurrenceStatus?: string;
    affectedArea?: number;
    cause?: string;
    vegetationCondition?: string;
    notes?: string;
    source?: string;
    sourceReference?: string;
  };
}

interface ImportReport {
  batchId: number;
  total: number;
  valid: number;
  warnings: number;
  invalid: number;
  duplicates: number;
  withCoords: number;
  withoutCoords: number;
  municipalities: string[];
  states: string[];
  period: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SYSTEM_FIELDS = [
  { key: "occurrenceDate",      label: "Data da ocorrência" },
  { key: "occurrenceTime",      label: "Horário" },
  { key: "municipality",        label: "Município" },
  { key: "state",               label: "Estado (UF)" },
  { key: "latitude",            label: "Latitude" },
  { key: "longitude",           label: "Longitude" },
  { key: "occurrenceType",      label: "Tipo de ocorrência" },
  { key: "occurrenceStatus",    label: "Situação" },
  { key: "affectedArea",        label: "Área afetada (ha)" },
  { key: "cause",               label: "Causa" },
  { key: "vegetationCondition", label: "Condição da vegetação" },
  { key: "notes",               label: "Observação" },
  { key: "source",              label: "Fonte" },
  { key: "sourceReference",     label: "Referência externa" },
];

const STEP_LABELS = ["Arquivo", "Mapeamento", "Validação", "Importação"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ""));
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(sep).map(p => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;
    const row: ParsedRow = {};
    headers.forEach((h, idx) => { row[h] = parts[idx] ?? ""; });
    rows.push(row);
  }
  return { headers, rows };
}

function autoMap(headers: string[]): Record<string, string> {
  const patterns: [string, RegExp][] = [
    ["occurrenceDate",      /data|date|dt_/i],
    ["occurrenceTime",      /hor[aá]|time|hora/i],
    ["municipality",        /munic/i],
    ["state",               /estado|uf\b|state/i],
    ["latitude",            /lat/i],
    ["longitude",           /lon|lng/i],
    ["occurrenceType",      /tipo|type/i],
    ["occurrenceStatus",    /situa|status/i],
    ["affectedArea",        /[aá]rea|area/i],
    ["cause",               /causa|cause/i],
    ["vegetationCondition", /vegeta/i],
    ["notes",               /obs|nota|note/i],
    ["source",              /^fonte$|^source$/i],
    ["sourceReference",     /refer|ref_|referencia/i],
  ];
  const mapping: Record<string, string> = {};
  for (const h of headers) {
    for (const [field, pattern] of patterns) {
      if (!Object.values(mapping).includes(h) && pattern.test(h)) {
        mapping[field] = h;
        break;
      }
    }
  }
  return mapping;
}

function validateRows(rows: ParsedRow[], mapping: Record<string, string>): ValidationRecord[] {
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const issues: string[] = [];
    const get = (field: string) => mapping[field] ? (row[mapping[field]] ?? "").trim() : "";

    const dateStr = get("occurrenceDate");
    const mun = get("municipality");
    const lat = parseFloat(get("latitude"));
    const lon = parseFloat(get("longitude"));

    if (!dateStr) issues.push("Data ausente");
    else if (!/^\d{4}-\d{2}-\d{2}$|^\d{2}\/\d{2}\/\d{4}$/.test(dateStr))
      issues.push("Formato de data inválido (esperado AAAA-MM-DD ou DD/MM/AAAA)");

    if (!mun) issues.push("Município ausente");

    const hasLat = get("latitude") !== "";
    const hasLon = get("longitude") !== "";
    if (hasLat && (isNaN(lat) || lat < -90 || lat > 90)) issues.push("Latitude inválida");
    if (hasLon && (isNaN(lon) || lon < -180 || lon > 180)) issues.push("Longitude inválida");

    // deduplication key
    const dedupKey = `${dateStr}|${mun}|${get("latitude")}|${get("longitude")}`;
    const isDuplicate = seen.has(dedupKey);
    if (isDuplicate) issues.push("Registro duplicado");
    else seen.add(dedupKey);

    const status: ValidationRecord["status"] =
      isDuplicate ? "duplicado"
      : issues.length > 0 && issues.some(i => !i.startsWith("Latitude") && !i.startsWith("Longitude") && !i.startsWith("Formato"))
        ? "inválido"
      : issues.length > 0 ? "válido com ressalvas"
      : "válido";

    return {
      index,
      status,
      row,
      issues,
      mapped: {
        occurrenceDate: dateStr || undefined,
        occurrenceTime: get("occurrenceTime") || undefined,
        municipality: mun || undefined,
        state: get("state") || undefined,
        latitude: hasLat && !isNaN(lat) ? lat : undefined,
        longitude: hasLon && !isNaN(lon) ? lon : undefined,
        occurrenceType: get("occurrenceType") || undefined,
        occurrenceStatus: get("occurrenceStatus") || undefined,
        affectedArea: parseFloat(get("affectedArea")) || undefined,
        cause: get("cause") || undefined,
        vegetationCondition: get("vegetationCondition") || undefined,
        notes: get("notes") || undefined,
        source: get("source") || undefined,
        sourceReference: get("sourceReference") || undefined,
      },
    };
  });
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    "válido":              { color: "bg-green-100 text-green-800",  label: "Válido" },
    "válido com ressalvas":{ color: "bg-yellow-100 text-yellow-800", label: "Com ressalvas" },
    "inválido":            { color: "bg-red-100 text-red-800",      label: "Inválido" },
    "duplicado":           { color: "bg-gray-100 text-gray-600",    label: "Duplicado" },
  };
  const s = map[status] ?? { color: "bg-gray-100 text-gray-600", label: status };
  return <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", s.color)}>{s.label}</span>;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DataImport() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0); // 0=upload 1=mapping 2=validation 3=done
  const [dragging, setDragging] = useState(false);
  const [filename, setFilename] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [validationResult, setValidationResult] = useState<ValidationRecord[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // ── File handling ──────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".csv") && !name.endsWith(".xls") && !name.endsWith(".xlsx")) {
      toast({ title: "Formato não suportado", description: "Utilize CSV, XLS ou XLSX.", variant: "destructive" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "Limite de 10 MB por arquivo.", variant: "destructive" });
      return;
    }
    setFilename(file.name);

    let parsedHeaders: string[] = [];
    let parsedRows: ParsedRow[] = [];

    if (name.endsWith(".csv")) {
      const text = await file.text();
      const parsed = parseCSV(text);
      parsedHeaders = parsed.headers;
      parsedRows = parsed.rows;
    } else {
      // XLS / XLSX — parsed via SheetJS
      try {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array", cellDates: true });
        if (!wb.SheetNames.length) {
          toast({ title: "Planilha vazia", description: "Nenhuma aba encontrada.", variant: "destructive" });
          return;
        }
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: "" });
        if (raw.length < 2) {
          toast({ title: "Planilha sem dados", description: "A primeira aba não contém linhas de dados.", variant: "destructive" });
          return;
        }
        parsedHeaders = (raw[0] as (string | number | null)[]).map(h => String(h ?? "").trim());
        parsedRows = (raw.slice(1) as (string | number | null)[][]).map(row => {
          const obj: ParsedRow = {};
          parsedHeaders.forEach((h, i) => { obj[h] = String(row[i] ?? "").trim(); });
          return obj;
        }).filter(row => Object.values(row).some(v => v !== ""));
      } catch {
        toast({ title: "Erro ao ler planilha", description: "Arquivo inválido ou corrompido.", variant: "destructive" });
        return;
      }
    }

    if (parsedHeaders.length === 0) {
      toast({ title: "Arquivo vazio ou inválido", description: "Nenhuma coluna detectada.", variant: "destructive" });
      return;
    }
    setHeaders(parsedHeaders);
    setRows(parsedRows);
    setMapping(autoMap(parsedHeaders));
    setStep(1);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  function runValidation() {
    const results = validateRows(rows, mapping);
    setValidationResult(results);
    setStep(2);
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function saveImport() {
    setSaving(true);
    try {
      const toSave = validationResult.filter(r => r.status !== "inválido" && r.status !== "duplicado");
      const payload = {
        filename,
        sourceName: sourceName || "Não especificada",
        records: validationResult.map(r => ({ ...r.mapped, validationStatus: r.status, rawData: r.row })),
      };
      const res = await fetch("/api/import-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      // Build local report
      const muns = Array.from(new Set(validationResult.map(r => r.mapped.municipality).filter(Boolean))) as string[];
      const sts = Array.from(new Set(validationResult.map(r => r.mapped.state).filter(Boolean))) as string[];
      const dates = validationResult.map(r => r.mapped.occurrenceDate).filter(Boolean) as string[];
      const period = dates.length > 0 ? `${dates.sort()[0]} a ${dates.sort().at(-1)}` : "—";

      setReport({
        batchId: data.batchId,
        total: validationResult.length,
        valid: toSave.filter(r => r.status === "válido").length,
        warnings: toSave.filter(r => r.status === "válido com ressalvas").length,
        invalid: validationResult.filter(r => r.status === "inválido").length,
        duplicates: validationResult.filter(r => r.status === "duplicado").length,
        withCoords: validationResult.filter(r => r.mapped.latitude != null && r.mapped.longitude != null).length,
        withoutCoords: validationResult.filter(r => r.mapped.latitude == null || r.mapped.longitude == null).length,
        municipalities: muns,
        states: sts,
        period,
      });
      setStep(3);
      toast({ title: "Importação concluída", description: `${toSave.length} registros salvos com sucesso.` });
    } catch (err) {
      toast({ title: "Erro ao salvar", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setStep(0); setFilename(""); setSourceName(""); setHeaders([]); setRows([]);
    setMapping({}); setValidationResult([]); setReport(null);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Layout>
      {/* Header */}
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-1">Módulo de importação</p>
        <h1 className="text-3xl font-bold font-display text-foreground flex items-center gap-2">
          <Upload className="w-7 h-7 text-primary" />
          Importação de Ocorrências
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Importe, valide e organize registros provenientes do Sisfogo ou de outras fontes autorizadas.
        </p>
        <div className="mt-2 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            A integração atual ocorre por <strong>importação de arquivos</strong> e não representa conexão direta ou oficial com o Sisfogo.
            Nenhum registro é descartado silenciosamente — todos são registrados com status de validação.
          </span>
        </div>
      </header>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-8">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
              i < step ? "bg-primary text-white" : i === step ? "bg-primary/20 text-primary border-2 border-primary" : "bg-muted text-muted-foreground"
            )}>
              {i < step ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
            </div>
            <span className={cn("text-sm font-medium", i === step ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            {i < STEP_LABELS.length - 1 && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* ── Step 0: Upload ── */}
      {step === 0 && (
        <div className="space-y-4">
          <div
            className={cn(
              "border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all",
              dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-secondary/20"
            )}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="w-12 h-12 mx-auto mb-4 text-primary/50" />
            <p className="text-lg font-semibold text-foreground mb-1">Arraste o arquivo aqui</p>
            <p className="text-sm text-muted-foreground mb-4">ou clique para selecionar</p>
            <p className="text-xs text-muted-foreground">CSV, XLS, XLSX — máximo 10 MB</p>
            <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={onFileChange} />
          </div>

          <div className="p-4 bg-card border border-border/50 rounded-xl">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Fonte dos dados</p>
            <input
              type="text"
              placeholder="Ex.: Sisfogo — exportação jul/2024, INPE, Defesa Civil GO"
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={sourceName}
              onChange={e => setSourceName(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3 p-3 bg-secondary/30 rounded-xl text-sm text-muted-foreground">
            <Download className="w-4 h-4 shrink-0 text-primary" />
            <span>Precisa de um modelo? </span>
            <a href="/demo-ocorrencias.csv" download className="text-primary font-medium underline hover:no-underline">
              Baixar CSV demonstrativo
            </a>
          </div>
        </div>
      )}

      {/* ── Step 1: Column Mapping ── */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-foreground">{filename}</p>
              <p className="text-sm text-muted-foreground">{rows.length} linhas detectadas · {headers.length} colunas</p>
            </div>
            <Button variant="outline" size="sm" onClick={reset}>Trocar arquivo</Button>
          </div>

          {/* Preview */}
          <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors text-sm font-semibold"
              onClick={() => setShowPreview(v => !v)}
            >
              <div className="flex items-center gap-2"><Table className="w-4 h-4 text-primary" /> Prévia das primeiras linhas</div>
              {showPreview ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {showPreview && (
              <div className="overflow-x-auto border-t border-border/30">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/30">
                    <tr>{headers.map(h => <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-t border-border/20 hover:bg-secondary/10">
                        {headers.map(h => <td key={h} className="px-3 py-2 text-foreground whitespace-nowrap max-w-32 truncate">{row[h]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Mapping */}
          <div className="bg-card border border-border/50 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-foreground text-sm">Mapeamento de colunas</h2>
              <span className="text-xs text-muted-foreground">(associe cada campo do sistema a uma coluna do arquivo)</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {SYSTEM_FIELDS.map(field => (
                <div key={field.key} className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground w-40 shrink-0">{field.label}</label>
                  <select
                    className="flex-1 text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                    value={mapping[field.key] ?? ""}
                    onChange={e => setMapping(prev => ({ ...prev, [field.key]: e.target.value }))}
                  >
                    <option value="">— ignorar —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <Button onClick={runValidation} className="w-full">
            <CheckCircle2 className="w-4 h-4 mr-2" /> Validar registros
          </Button>
        </div>
      )}

      {/* ── Step 2: Validation ── */}
      {step === 2 && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total", value: validationResult.length, color: "text-foreground" },
              { label: "Válidos", value: validationResult.filter(r => r.status === "válido").length, color: "text-green-600" },
              { label: "Com ressalvas", value: validationResult.filter(r => r.status === "válido com ressalvas").length, color: "text-yellow-600" },
              { label: "Inválidos", value: validationResult.filter(r => r.status === "inválido").length, color: "text-red-600" },
              { label: "Duplicados", value: validationResult.filter(r => r.status === "duplicado").length, color: "text-gray-500" },
              { label: "Com coords.", value: validationResult.filter(r => r.mapped.latitude != null).length, color: "text-blue-600" },
              { label: "Sem coords.", value: validationResult.filter(r => r.mapped.latitude == null).length, color: "text-muted-foreground" },
              { label: "Para importar", value: validationResult.filter(r => r.status !== "inválido" && r.status !== "duplicado").length, color: "text-primary font-bold" },
            ].map(s => (
              <div key={s.label} className="bg-card border border-border/50 rounded-xl p-4 text-center">
                <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Errors toggle */}
          {validationResult.some(r => r.issues.length > 0) && (
            <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between p-4 hover:bg-secondary/30 text-sm font-semibold"
                onClick={() => setShowErrors(v => !v)}
              >
                <div className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-yellow-500" /> Inconsistências detectadas</div>
                {showErrors ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              {showErrors && (
                <div className="border-t border-border/30 max-h-64 overflow-y-auto">
                  {validationResult.filter(r => r.issues.length > 0).slice(0, 50).map(r => (
                    <div key={r.index} className="px-4 py-2 border-b border-border/10 flex items-start gap-3 text-xs">
                      <span className="text-muted-foreground shrink-0">Linha {r.index + 2}</span>
                      <StatusBadge status={r.status} />
                      <span className="text-foreground">{r.issues.join("; ")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Validation table */}
          <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
            <p className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/30">
              Registros ({validationResult.length})
            </p>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-secondary/30 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">#</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Data</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Município</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">UF</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Coords.</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Inconsistências</th>
                  </tr>
                </thead>
                <tbody>
                  {validationResult.map(r => (
                    <tr key={r.index} className="border-t border-border/20 hover:bg-secondary/10">
                      <td className="px-3 py-1.5 text-muted-foreground">{r.index + 2}</td>
                      <td className="px-3 py-1.5"><StatusBadge status={r.status} /></td>
                      <td className="px-3 py-1.5 text-foreground">{r.mapped.occurrenceDate ?? "—"}</td>
                      <td className="px-3 py-1.5 text-foreground">{r.mapped.municipality ?? "—"}</td>
                      <td className="px-3 py-1.5 text-foreground">{r.mapped.state ?? "—"}</td>
                      <td className="px-3 py-1.5">{r.mapped.latitude != null ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <XCircle className="w-3.5 h-3.5 text-muted-foreground" />}</td>
                      <td className="px-3 py-1.5 text-yellow-700">{r.issues.join("; ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep(1)}>Revisar mapeamento</Button>
            <Button onClick={saveImport} disabled={saving} className="flex-1">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</> : <><Download className="w-4 h-4 mr-2" /> Confirmar e importar</>}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Done ── */}
      {step === 3 && report && (
        <div className="space-y-6">
          <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-3" />
            <h2 className="text-xl font-bold text-green-900">Importação concluída</h2>
            <p className="text-sm text-green-700 mt-1">Lote #{report.batchId} · {filename}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total de linhas", value: report.total },
              { label: "Válidos", value: report.valid, sub: "importados" },
              { label: "Com ressalvas", value: report.warnings, sub: "importados" },
              { label: "Inválidos", value: report.invalid, sub: "rejeitados" },
              { label: "Duplicados", value: report.duplicates, sub: "ignorados" },
              { label: "Com coordenadas", value: report.withCoords },
              { label: "Sem coordenadas", value: report.withoutCoords },
              { label: "Municípios", value: report.municipalities.length },
            ].map(s => (
              <div key={s.label} className="bg-card border border-border/50 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
                {s.sub && <p className="text-xs text-primary font-medium">{s.sub}</p>}
              </div>
            ))}
          </div>

          <div className="bg-card border border-border/50 rounded-xl p-5 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Período encontrado</span>
              <span className="font-medium">{report.period}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Estados</span>
              <span className="font-medium">{report.states.join(", ") || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Municípios</span>
              <span className="font-medium text-right max-w-xs">{report.municipalities.slice(0, 8).join(", ")}{report.municipalities.length > 8 ? " ..." : ""}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fonte informada</span>
              <span className="font-medium">{sourceName || "Não especificada"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tipo de dados</span>
              <span className="font-medium text-amber-700">Arquivo importado — não representa integração oficial</span>
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => window.location.href = "/maps"}>
              <MapPin className="w-4 h-4 mr-2" /> Ver no mapa
            </Button>
            <Button variant="outline" className="flex-1" onClick={reset}>
              <RotateCcw className="w-4 h-4 mr-2" /> Nova importação
            </Button>
          </div>
        </div>
      )}
    </Layout>
  );
}
