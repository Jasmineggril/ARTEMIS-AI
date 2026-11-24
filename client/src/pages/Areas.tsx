import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MapPinned, Plus, Flame, Search, Pencil, Trash2, Download, X, FlaskConical } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "@/components/RiskBadge";
import { useToast } from "@/hooks/use-toast";
import { useAuthStatus, hasRole } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { BR_STATES } from "@shared/br-states";
import type { MonitoredArea } from "@shared/schema";
import type { RiskLevel } from "@shared/risk-engine";
import type { BoundaryGeom } from "@shared/geometry";
import { BoundaryEditor } from "@/components/map/BoundaryEditor";
import { readBoundaryFile } from "@/lib/geo-import";

export const OPERATION_LABELS: Record<string, string> = {
  propriedade_rural: "Propriedade rural",
  agroindustria: "Agroindústria",
  florestal: "Empresa florestal",
  energia: "Energia",
  mineracao: "Mineração",
  logistica: "Logística",
  industria: "Indústria",
  unidade_conservacao: "Unidade de conservação",
  outro: "Outro",
};

type AreaRow = MonitoredArea & {
  latestAnalysis: { id: number; score: number; level: RiskLevel; createdAt: string; engineType: string; isExperimental: boolean } | null;
};

type FormState = {
  name: string; operationType: string; municipality: string; state: string; latitude: string; longitude: string;
  areaHectares: string; vegetationCategory: string; notes: string; status: string;
  boundary: BoundaryGeom | null; boundarySource: string | null; hotspotAlertKm: string;
};

const EMPTY: FormState = {
  name: "", operationType: "propriedade_rural", municipality: "", state: "GO", latitude: "", longitude: "",
  areaHectares: "", vegetationCategory: "", notes: "", status: "ativo",
  boundary: null, boundarySource: null, hotspotAlertKm: "5",
};

function toForm(a: MonitoredArea): FormState {
  return {
    name: a.name, operationType: a.operationType, municipality: a.municipality, state: a.state,
    // values calculated from the polygon are left blank so they keep following the polygon
    latitude: a.coordinatesSource === "centro_do_poligono" ? "" : a.latitude?.toString() ?? "",
    longitude: a.coordinatesSource === "centro_do_poligono" ? "" : a.longitude?.toString() ?? "",
    areaHectares: a.areaHectaresSource === "calculada" ? "" : a.areaHectares?.toString() ?? "",
    vegetationCategory: a.vegetationCategory ?? "",
    boundary: (a.boundary as BoundaryGeom | null) ?? null, boundarySource: a.boundarySource ?? null,
    hotspotAlertKm: String(a.hotspotAlertKm ?? 5), notes: a.notes ?? "", status: a.status,
  };
}

function parseForm(f: FormState): { body?: Record<string, unknown>; error?: string } {
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const lat = num(f.latitude), lng = num(f.longitude), ha = num(f.areaHectares), km = num(f.hotspotAlertKm);
  if ([lat, lng, ha, km].some((v) => v !== null && Number.isNaN(v))) return { error: "Coordenadas, área e distância devem ser numéricas." };
  if ((lat === null) !== (lng === null)) return { error: "Informe latitude e longitude juntas (ou deixe as duas em branco para usar o centro do polígono)." };
  if (!f.boundary && lat === null) return { error: "Informe o limite da propriedade (desenho ou arquivo) ou, ao menos, latitude e longitude." };
  return {
    body: {
      name: f.name.trim(), operationType: f.operationType, municipality: f.municipality.trim(), state: f.state,
      latitude: lat, longitude: lng, areaHectares: ha, vegetationCategory: f.vegetationCategory.trim() || null,
      boundary: f.boundary, ...(f.boundary && f.boundarySource ? { boundarySource: f.boundarySource } : {}),
      hotspotAlertKm: km ?? 5, notes: f.notes.trim() || null, status: f.status,
    },
  };
}

function AreaForm({ initial, onClose, editingId }: { initial: FormState; onClose: (savedId?: number) => void; editingId: number | null }) {
  const [f, setF] = useState<FormState>(initial);
  const [error, setError] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const [importMsg, setImportMsg] = useState("");
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editingId ? api<{ id: number; warnings?: string[] }>("PATCH", `/api/areas/${editingId}`, body) : api<{ id: number; warnings?: string[] }>("POST", "/api/areas", body),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["/api/areas"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
      toast({ title: editingId ? "Área atualizada" : "Área cadastrada", description: r.warnings?.length ? r.warnings.join(" ") : undefined });
      onClose(r.id);
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const { body, error } = parseForm(f);
    if (error) return setError(error);
    setError("");
    save.mutate(body!);
  }

  async function importFile(file: File) {
    setError(""); setImportMsg("Lendo arquivo…");
    try {
      const r = await readBoundaryFile(file);
      setF((cur) => ({ ...cur, boundary: r.geometry, boundarySource: r.source }));
      setImportMsg(`${r.fileName}: ${r.polygons} polígono(s) importado(s)${r.ignored ? `; ${r.ignored} elemento(s) que não são polígonos foram ignorados` : ""}. Confira o desenho no mapa.`);
    } catch (e) {
      setImportMsg("");
      setError(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    }
  }
  function applyPasted() {
    try {
      const blob = new File([pasted], "colado.geojson", { type: "application/geo+json" });
      void importFile(blob);
      setPasting(false);
    } catch { setError("GeoJSON inválido."); }
  }
  const latN = Number(f.latitude.replace(",", ".")), lngN = Number(f.longitude.replace(",", "."));
  const center: [number, number] | null = f.latitude && f.longitude && Number.isFinite(latN) && Number.isFinite(lngN) ? [latN, lngN] : null;

  const label = "block text-sm font-medium mb-1";
  const input = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="area-form-title" className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <form onSubmit={submit} className="bg-card w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-6 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 id="area-form-title" className="text-xl font-bold">{editingId ? "Editar área" : "Nova área monitorada"}</h2>
          <button type="button" onClick={() => onClose()} aria-label="Fechar" className="p-2 rounded-lg hover:bg-secondary"><X className="w-5 h-5" /></button>
        </div>
        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><label htmlFor="a-name" className={label}>Nome da propriedade ou unidade *</label>
            <input id="a-name" className={input} value={f.name} onChange={set("name")} required minLength={2} /></div>
          <div><label htmlFor="a-op" className={label}>Tipo de atividade *</label>
            <select id="a-op" className={input} value={f.operationType} onChange={set("operationType")}>
              {Object.entries(OPERATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label htmlFor="a-veg" className={label}>Categoria de vegetação</label>
            <input id="a-veg" className={input} value={f.vegetationCategory} onChange={set("vegetationCategory")} placeholder="Ex.: Cerrado, pastagem, eucalipto" /></div>
          <div><label htmlFor="a-mun" className={label}>Município *</label>
            <input id="a-mun" className={input} value={f.municipality} onChange={set("municipality")} required /></div>
          <div><label htmlFor="a-uf" className={label}>UF *</label>
            <select id="a-uf" className={input} value={f.state} onChange={set("state")}>
              {BR_STATES.map((s) => <option key={s}>{s}</option>)}
            </select></div>
          <fieldset className="sm:col-span-2 rounded-xl border p-3 space-y-2">
            <legend className="text-sm font-medium px-1">Limite da propriedade</legend>
            <BoundaryEditor value={f.boundary} center={center} onChange={(g, src) => { setF((cur) => ({ ...cur, boundary: g, boundarySource: g ? src : null })); setImportMsg(""); }} />
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="underline cursor-pointer">
                Importar arquivo (.geojson, .kml, .kmz ou shapefile .zip do CAR)
                <input type="file" accept=".geojson,.json,.kml,.kmz,.zip,application/geo+json,application/json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,application/zip" className="sr-only"
                  data-testid="input-boundary-file" onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = ""; }} />
              </label>
              <button type="button" className="underline" onClick={() => setPasting((v) => !v)}>Colar GeoJSON</button>
              {f.boundarySource && <span className="text-muted-foreground">origem: {f.boundarySource === "desenho" ? "desenhado no mapa" : `arquivo ${f.boundarySource.toUpperCase()}`}</span>}
            </div>
            {pasting && <div className="space-y-1">
              <label htmlFor="a-geo" className="sr-only">GeoJSON</label>
              <textarea id="a-geo" className={`${input} font-mono text-xs h-20`} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{"type":"Polygon","coordinates":[[[lon,lat], ...]]}' />
              <Button type="button" size="sm" variant="outline" onClick={applyPasted} disabled={!pasted.trim()}>Usar este GeoJSON</Button>
            </div>}
            {importMsg && <p role="status" className="text-xs text-emerald-800">{importMsg}</p>}
            <p className="text-xs text-muted-foreground">Coordenadas em graus decimais (WGS 84 / SIRGAS 2000). O servidor confere se o polígono é fechado, se as bordas não se cruzam e se está no Brasil.
              Com o limite cadastrado, área e coordenadas em branco são <strong>calculadas a partir do polígono</strong> (e marcadas como calculadas).</p>
          </fieldset>
          <div><label htmlFor="a-lat" className={label}>Latitude (graus decimais)</label>
            <input id="a-lat" className={input} inputMode="decimal" value={f.latitude} onChange={set("latitude")} placeholder="-14.1300" /></div>
          <div><label htmlFor="a-lng" className={label}>Longitude (graus decimais)</label>
            <input id="a-lng" className={input} inputMode="decimal" value={f.longitude} onChange={set("longitude")} placeholder="-47.5100" /></div>
          <div><label htmlFor="a-ha" className={label}>Área informada (hectares)</label>
            <input id="a-ha" className={input} inputMode="decimal" value={f.areaHectares} onChange={set("areaHectares")} placeholder={f.boundary ? "em branco = calculada do polígono" : ""} /></div>
          <div><label htmlFor="a-km" className={label}>Alertar focos de calor a até (km)</label>
            <input id="a-km" className={input} inputMode="decimal" value={f.hotspotAlertKm} onChange={set("hotspotAlertKm")} aria-describedby="a-km-help" />
            <p id="a-km-help" className="text-xs text-muted-foreground mt-1">Distância do limite (0 = só dentro da propriedade). Máx. 50 km.</p></div>
          <div><label htmlFor="a-st" className={label}>Situação</label>
            <select id="a-st" className={input} value={f.status} onChange={set("status")}>
              <option value="ativo">Ativo</option><option value="em análise">Em análise</option><option value="inativo">Inativo</option>
            </select></div>
          <div className="sm:col-span-2"><label htmlFor="a-notes" className={label}>Observações</label>
            <textarea id="a-notes" className={`${input} h-20`} value={f.notes} onChange={set("notes")} /></div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onClose()}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Salvando..." : "Salvar"}</Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export default function Areas() {
  const [, setLocation] = useLocation();
  const { data: user } = useAuthStatus();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<"all" | RiskLevel | "sem_analise">("all");
  const [form, setForm] = useState<{ initial: FormState; id: number | null } | null>(null);

  const { data: areas = [], isLoading, error } = useQuery<AreaRow[]>({
    queryKey: ["/api/areas"],
    queryFn: () => api("GET", "/api/areas"),
  });

  // /areas?edit=ID (from the property page) opens the editor for that area
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("edit"));
    const target = id ? areas.find((x) => x.id === id) : undefined;
    if (target && !form) {
      setForm({ initial: toForm(target), id: target.id });
      window.history.replaceState(null, "", "/areas");
    }
  }, [areas]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = useMutation({
    mutationFn: (id: number) => api("DELETE", `/api/areas/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/areas"] });
      toast({ title: "Área removida", description: "O histórico de análises foi mantido para rastreabilidade." });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const canEdit = hasRole(user, "manager");
  const canDelete = hasRole(user, "admin");
  const canAnalyze = hasRole(user, "analyst");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return areas
      .filter((a) => level === "all" || (level === "sem_analise" ? !a.latestAnalysis : a.latestAnalysis?.level === level))
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.municipality.toLowerCase().includes(q))
      .sort((a, b) => (b.latestAnalysis?.score ?? -1) - (a.latestAnalysis?.score ?? -1));
  }, [areas, search, level]);

  return (
    <Layout>
      <header className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display flex items-center gap-2"><MapPinned className="w-8 h-8 text-primary" aria-hidden />Áreas Monitoradas</h1>
          <p className="text-muted-foreground mt-1">
            {user?.organization?.name ?? "Organização"} · {areas.length} área(s) cadastrada(s). Somente membros desta organização veem estes dados.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setForm({ initial: EMPTY, id: null })} data-testid="button-new-area">
            <Plus className="w-4 h-4 mr-1" aria-hidden /> Nova área
          </Button>
        )}
      </header>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label htmlFor="area-search" className="sr-only">Buscar área ou município</label>
          <input id="area-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou município"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-input bg-background text-sm" />
        </div>
        <label htmlFor="level-filter" className="sr-only">Filtrar por nível de risco</label>
        <select id="level-filter" value={level} onChange={(e) => setLevel(e.target.value as any)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
          <option value="all">Todos os níveis</option>
          <option value="crítico">Crítico</option><option value="alto">Alto</option>
          <option value="moderado">Moderado</option><option value="baixo">Baixo</option>
          <option value="sem_analise">Sem análise</option>
        </select>
      </div>

      {isLoading && <p className="text-muted-foreground">Carregando áreas...</p>}
      {error && <p role="alert" className="text-red-700">Não foi possível carregar as áreas: {(error as Error).message}</p>}

      {!isLoading && areas.length === 0 && (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <MapPinned className="w-10 h-10 mx-auto text-muted-foreground mb-3" aria-hidden />
          <h2 className="font-semibold text-lg">Nenhuma área cadastrada</h2>
          <p className="text-muted-foreground text-sm mt-1 max-w-md mx-auto">
            Cadastre a primeira propriedade ou unidade para executar análises de risco e receber alertas.
            {!canEdit && " Peça a um gestor da organização para cadastrar."}
          </p>
          {canEdit && <Button className="mt-4" onClick={() => setForm({ initial: EMPTY, id: null })}>Cadastrar área</Button>}
        </div>
      )}

      <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((a) => (
          <li key={a.id} className="rounded-2xl border bg-card p-5 shadow-sm flex flex-col gap-3" data-testid={`card-area-${a.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-bold leading-snug break-words">{a.name}</h2>
                <p className="text-sm text-muted-foreground">{a.municipality}/{a.state} · {OPERATION_LABELS[a.operationType] ?? a.operationType}</p>
              </div>
              {a.latestAnalysis ? <RiskBadge level={a.latestAnalysis.level} score={a.latestAnalysis.score} size="sm" showIcon />
                : <span className="text-xs rounded-full border px-2 py-0.5 text-muted-foreground">Sem análise</span>}
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Área</dt><dd>{a.areaHectares != null ? `${a.areaHectares.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha${a.areaHectaresSource === "calculada" ? " (calculada do polígono)" : " (informada)"}` : "—"}</dd>
              <dt className="text-muted-foreground">Coordenadas</dt><dd>{a.latitude != null ? `${a.latitude.toFixed(4)}, ${a.longitude!.toFixed(4)}${a.coordinatesSource === "centro_do_poligono" ? " (centro do polígono)" : ""}` : "não informadas"}</dd>
              <dt className="text-muted-foreground">Limite</dt><dd>{a.boundary ? `polígono${a.boundaryAreaHa ? ` · ${a.boundaryAreaHa.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha` : ""}` : "não informado"}</dd>
              <dt className="text-muted-foreground">Última análise</dt>
              <dd>{a.latestAnalysis ? format(new Date(a.latestAnalysis.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "—"}
                {a.latestAnalysis?.isExperimental && <FlaskConical className="inline w-3 h-3 ml-1 text-violet-600" aria-label="experimental" />}</dd>
            </dl>
            <div className="flex flex-wrap gap-2 mt-auto pt-2">
              <Button size="sm" variant="outline" onClick={() => setLocation(`/areas/${a.id}`)} data-testid={`button-open-area-${a.id}`}>
                <MapPinned className="w-4 h-4 mr-1" aria-hidden /> Abrir
              </Button>
              {canAnalyze && (
                <Button size="sm" onClick={() => setLocation(`/risk-analysis?area=${a.id}`)}>
                  <Flame className="w-4 h-4 mr-1" aria-hidden /> Analisar risco
                </Button>
              )}
              {a.latestAnalysis && canAnalyze && (
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/reports/areas/${a.id}/analyses.csv`} download><Download className="w-4 h-4 mr-1" aria-hidden />CSV</a>
                </Button>
              )}
              {canEdit && (
                <Button size="sm" variant="outline" onClick={() => setForm({ initial: toForm(a), id: a.id })} aria-label={`Editar ${a.name}`}>
                  <Pencil className="w-4 h-4" aria-hidden />
                </Button>
              )}
              {canDelete && (
                <Button size="sm" variant="outline" aria-label={`Remover ${a.name}`}
                  onClick={() => { if (window.confirm(`Remover a área "${a.name}"? O histórico de análises será mantido.`)) remove.mutate(a.id); }}>
                  <Trash2 className="w-4 h-4" aria-hidden />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {form && <AreaForm initial={form.initial} editingId={form.id} onClose={(savedId) => { const wasNew = form.id === null; setForm(null); if (savedId && wasNew) setLocation(`/areas/${savedId}`); }} />}
    </Layout>
  );
}
