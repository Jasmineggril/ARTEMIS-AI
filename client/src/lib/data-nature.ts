/** How each input of an analysis was obtained — shown next to the value in results and reports. */
export const ORIGIN_LABEL: Record<string, string> = {
  manual: "informado pelo usuário",
  "inmet-estacao": "INMET — medição de estação automática",
  "open-meteo": "Open-Meteo (modelo numérico)",
  "base-historica-organizacao": "ocorrências importadas pela organização (raio 10 km)",
  "sisfogo-roi": "ROIs oficiais do Sisfogo (raio 10 km)",
  "inpe-queimadas": "focos de calor do INPE (satélite)",
  "nao-verificado": "não verificado (dados do INPE indisponíveis)",
};

export type Nature = "informado" | "medido_estacao" | "estimado" | "observado" | "registro" | "registro_oficial" | "nao_verificado";
export const NATURE_OF: Record<string, Nature> = {
  manual: "informado", "inmet-estacao": "medido_estacao", "open-meteo": "estimado", "inpe-queimadas": "observado",
  "base-historica-organizacao": "registro", "sisfogo-roi": "registro_oficial", "nao-verificado": "nao_verificado",
};
export const NATURE_LABEL: Record<Nature, { label: string; help: string; cls: string }> = {
  informado: { label: "Informado", help: "valor digitado pelo usuário; não verificado pela plataforma", cls: "bg-slate-100 text-slate-800 border-slate-300" },
  medido_estacao: { label: "Medição oficial", help: "observação de estação do INMET; medida no local da estação, não na propriedade", cls: "bg-emerald-50 text-emerald-900 border-emerald-300" },
  estimado: { label: "Estimativa", help: "modelo meteorológico para a coordenada; não é medição local", cls: "bg-sky-50 text-sky-900 border-sky-300" },
  observado: { label: "Observado", help: "detecção por satélite (INPE); não é incêndio confirmado", cls: "bg-violet-50 text-violet-900 border-violet-300" },
  registro: { label: "Registro", help: "histórico importado pela organização", cls: "bg-orange-50 text-orange-900 border-orange-300" },
  registro_oficial: { label: "Registro oficial", help: "ROI finalizado publicado pelo Ibama/Prevfogo", cls: "bg-amber-50 text-amber-900 border-amber-300" },
  nao_verificado: { label: "Não verificado", help: "fonte indisponível ou desatualizada; considerado ausente", cls: "bg-red-50 text-red-900 border-red-300" },
};

export const FIELD_LABEL: Record<string, string> = {
  temperature: "Temperatura", humidity: "Umidade relativa", windSpeed: "Vento", recentRainfall: "Precipitação 72 h",
  historicalOccurrences: "Ocorrências históricas", vegetationCondition: "Vegetação", nearbyHotspot: "Foco próximo",
};

const VEG = ["muito seca", "seca", "moderada", "úmida"];
/** Human value of a stored engine input. */
export function formatInput(field: string, inputs: Record<string, unknown> | null | undefined): string {
  const v = inputs?.[field];
  if (v === undefined || v === null) return "—";
  switch (field) {
    case "temperature": return `${v} °C`;
    case "humidity": return `${v} %`;
    case "windSpeed": return `${v} km/h`;
    case "recentRainfall": return `${v} mm`;
    case "vegetationCondition": return typeof v === "number" ? VEG[v] ?? String(v) : String(v);
    case "nearbyHotspot": return v ? `sim${inputs?.hotspotDistance != null ? ` (${inputs.hotspotDistance} km)` : ""}` : "não";
    case "historicalOccurrences": return `${v} registro(s)`;
    default: return String(v);
  }
}
