import { useState, useEffect, useRef } from "react";
import { Layout } from "@/components/Layout";
import { RiskBadge, riskLevelColor, riskLevelDescription } from "@/components/RiskBadge";
import { calculateRisk, DEMO_SCENARIOS } from "@shared/risk-engine";
import { SIMULATED_DATA_LABEL, DECISION_SUPPORT_DISCLAIMER } from "@shared/identity";
import { useAlerts } from "@/hooks/use-alerts";
import { useLocation } from "wouter";
import { MapPin, Flame, Filter, X, Bell, FileText, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getClosestBiome, type BrazilianBiome } from "@/lib/biomes";
import type { RiskLevel } from "@shared/risk-engine";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  GeoJSON,
  useMap,
} from "react-leaflet";
import L from "leaflet";

// Fix Leaflet default icon paths broken by Vite bundler
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// ── Biome GeoJSON polygons (simplified approximations for Brazil) ────────────
const BIOME_COLORS: Record<BrazilianBiome, string> = {
  "Amazônia":      "#2d6a2d",
  "Cerrado":       "#b8860b",
  "Mata Atlântica":"#1a6b3a",
  "Caatinga":      "#c4713a",
  "Pantanal":      "#2e7d7d",
  "Pampa":         "#5a8a3c",
};

// Simplified polygon coordinates [lon, lat] — approximate visual representations
const BIOME_GEOJSON: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { biome: "Amazônia" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-74, 5], [-50, 5], [-44, 0], [-44, -8], [-48, -13], [-55, -16],
          [-60, -15], [-68, -10], [-73, -5], [-74, 5],
        ]],
      },
    },
    {
      type: "Feature",
      properties: { biome: "Cerrado" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-60, -4], [-47, -2], [-41, -6], [-40, -14], [-40, -24],
          [-55, -24], [-60, -18], [-60, -4],
        ]],
      },
    },
    {
      type: "Feature",
      properties: { biome: "Caatinga" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-44, -3], [-34.5, -3], [-34.5, -15], [-44, -15], [-44, -3],
        ]],
      },
    },
    {
      type: "Feature",
      properties: { biome: "Mata Atlântica" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-50, -5], [-34, -6], [-34, -33], [-52, -33], [-52, -25],
          [-47, -18], [-46, -12], [-50, -5],
        ]],
      },
    },
    {
      type: "Feature",
      properties: { biome: "Pantanal" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-58.5, -15], [-54, -15], [-54, -22.5], [-58.5, -22.5], [-58.5, -15],
        ]],
      },
    },
    {
      type: "Feature",
      properties: { biome: "Pampa" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-57.5, -27.5], [-48.5, -27.5], [-48.5, -33.8], [-57.5, -33.8], [-57.5, -27.5],
        ]],
      },
    },
  ],
};

// ── Demo areas ───────────────────────────────────────────────────────────────
const DEMO_AREAS = Object.entries(DEMO_SCENARIOS).map(([key, s], i) => {
  const lat = [-14.12, -14.47, -16.68, -14.54][i] ?? -14;
  const lng = [-47.51, -48.46, -49.25, -50.26][i] ?? -47;
  return {
    id: i + 1,
    key,
    name: `Área Demo ${i + 1}`,
    operationType: ["Agroindústria", "Empresa florestal", "Energia", "Mineração"][i] ?? "Outro",
    municipality: ["Alto Paraíso/GO", "Niquelândia/GO", "Goiânia/GO", "Crixás/GO"][i] ?? "—",
    latitude: lat,
    longitude: lng,
    areaHectares: [1200, 850, 3500, 2100][i] ?? 1000,
    biome: getClosestBiome(lat, lng),
    risk: calculateRisk(s.input, true),
    isSimulated: true,
  };
});

type FilterLevel = "all" | RiskLevel;
type FilterType  = "all" | string;

// Sub-component: fly to selected area
function FlyToArea({ area }: { area: typeof DEMO_AREAS[0] | null }) {
  const map = useMap();
  useEffect(() => {
    if (area) map.flyTo([area.latitude, area.longitude], 9, { duration: 1 });
  }, [area, map]);
  return null;
}

export default function CeresMaps() {
  const [, setLocation] = useLocation();
  const { data: alerts } = useAlerts();
  const [selectedArea, setSelectedArea] = useState<typeof DEMO_AREAS[0] | null>(null);
  const [filterLevel, setFilterLevel] = useState<FilterLevel>("all");
  const [filterType, setFilterType]   = useState<FilterType>("all");
  const [showBiomes, setShowBiomes]   = useState(true);

  const opTypes = Array.from(new Set(DEMO_AREAS.map(a => a.operationType)));

  const filteredAreas = DEMO_AREAS.filter(a => {
    const levelOk = filterLevel === "all" || a.risk.level === filterLevel;
    const typeOk  = filterType  === "all" || a.operationType === filterType;
    return levelOk && typeOk;
  });

  const activeAlerts = alerts?.filter(a => !a.isResolved).length ?? 0;

  const levelCounts = DEMO_AREAS.reduce((acc, a) => {
    acc[a.risk.level] = (acc[a.risk.level] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // GeoJSON style per feature
  const biomeStyle = (feature?: GeoJSON.Feature) => {
    const biome = feature?.properties?.biome as BrazilianBiome | undefined;
    const color = biome ? BIOME_COLORS[biome] : "#666";
    return { color, weight: 1.5, fillColor: color, fillOpacity: 0.18, opacity: 0.5 };
  };

  const onEachBiome = (feature: GeoJSON.Feature, layer: L.Layer) => {
    const biome = feature.properties?.biome as string;
    (layer as L.Path).bindTooltip(biome, { sticky: true, className: "biome-tooltip" });
  };

  return (
    <Layout>
      <header className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-foreground flex items-center gap-2">
            <MapPin className="w-8 h-8 text-primary" />
            Mapa de Risco
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {DEMO_AREAS.length} áreas monitoradas · 6 biomas brasileiros ·{" "}
            <span className="text-amber-600">{SIMULATED_DATA_LABEL}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {activeAlerts > 0 && (
            <button
              onClick={() => setLocation("/alerts")}
              className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-red-100 transition-colors"
            >
              <Bell className="w-4 h-4" />
              {activeAlerts} alerta{activeAlerts !== 1 ? "s" : ""} ativo{activeAlerts !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Filter className="w-4 h-4" /> Filtrar:
        </div>
        {(["all", "baixo", "moderado", "alto", "crítico"] as const).map(level => (
          <button
            key={level}
            onClick={() => setFilterLevel(level)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
              filterLevel === level
                ? "bg-primary text-white border-primary"
                : "bg-card border-border/50 text-muted-foreground hover:border-primary/50"
            )}
          >
            {level === "all" ? "Todos os níveis" : level.charAt(0).toUpperCase() + level.slice(1)}
            {level !== "all" && levelCounts[level] ? ` (${levelCounts[level]})` : ""}
          </button>
        ))}
        <select
          className="px-3 py-1.5 text-xs border border-border/50 rounded-full bg-card text-muted-foreground focus:outline-none"
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
        >
          <option value="all">Todos os setores</option>
          {opTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          onClick={() => setShowBiomes(b => !b)}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
            showBiomes
              ? "bg-emerald-700 text-white border-emerald-700"
              : "bg-card border-border/50 text-muted-foreground hover:border-primary/50"
          )}
        >
          🌿 Biomas
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Map */}
        <div className="md:col-span-2 flex flex-col gap-3">
          {/* Biome legend */}
          {showBiomes && (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {(Object.entries(BIOME_COLORS) as [BrazilianBiome, string][]).map(([biome, color]) => (
                <div key={biome} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="w-3 h-3 rounded-sm border border-white/50" style={{ backgroundColor: color, opacity: 0.7 }} />
                  {biome}
                </div>
              ))}
            </div>
          )}

          {/* Risk legend */}
          <div className="flex flex-wrap gap-3">
            {(["baixo", "moderado", "alto", "crítico"] as RiskLevel[]).map(level => (
              <div key={level} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-3 h-3 rounded-full border border-white shadow-sm"
                  style={{ backgroundColor: riskLevelColor(level) }} />
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </div>
            ))}
          </div>

          {/* Real Leaflet Map */}
          <div className="rounded-2xl overflow-hidden border border-border/30 shadow-lg" style={{ height: 460 }}>
            <MapContainer
              center={[-14.5, -48.5]}
              zoom={6}
              style={{ height: "100%", width: "100%" }}
              scrollWheelZoom={true}
            >
              {/* Satellite imagery — ESRI World Imagery (free, no API key) */}
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                attribution='Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
                maxZoom={19}
              />

              {/* Biome polygons */}
              {showBiomes && (
                <GeoJSON
                  key="biomes"
                  data={BIOME_GEOJSON}
                  style={biomeStyle}
                  onEachFeature={onEachBiome}
                />
              )}

              {/* Area markers */}
              {filteredAreas.map(area => (
                <CircleMarker
                  key={area.id}
                  center={[area.latitude, area.longitude]}
                  radius={selectedArea?.id === area.id ? 16 : 12}
                  pathOptions={{
                    color: "#fff",
                    weight: 2,
                    fillColor: riskLevelColor(area.risk.level),
                    fillOpacity: 0.9,
                  }}
                  eventHandlers={{
                    click: () => setSelectedArea(prev => prev?.id === area.id ? null : area),
                  }}
                >
                  <Popup minWidth={220} maxWidth={220}>
                    <div style={{ fontFamily: "inherit", background: "#0f1f14" }}>
                      {/* Header strip */}
                      <div style={{ background: riskLevelColor(area.risk.level), padding: "10px 14px 8px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span style={{ color: "#fff", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.85 }}>
                            {area.operationType}
                          </span>
                          <span style={{ background: "rgba(0,0,0,0.25)", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 20, padding: "2px 8px", textTransform: "uppercase" }}>
                            {area.risk.level}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, marginTop: 4 }}>
                          <span style={{ color: "#fff", fontSize: 40, fontWeight: 800, lineHeight: 1 }}>
                            {area.risk.score}
                          </span>
                          <div style={{ paddingBottom: 4 }}>
                            <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>/100</span>
                            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 10, marginTop: 1 }}>
                              {Math.round(area.risk.confidence * 100)}% confiança
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Body */}
                      <div style={{ padding: "10px 14px", background: "#0f1f14" }}>
                        <p style={{ color: "#d1fae5", fontWeight: 700, fontSize: 13, margin: 0 }}>{area.name}</p>
                        <p style={{ color: "#6ee7b7", fontSize: 11, margin: "2px 0 8px" }}>📍 {area.municipality}</p>

                        {/* Biome pill */}
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.07)", borderRadius: 20, padding: "3px 10px", marginBottom: 8 }}>
                          <span style={{ fontSize: 10 }}>🌿</span>
                          <span style={{ color: "#a7f3d0", fontSize: 11, fontWeight: 600 }}>{area.biome}</span>
                        </div>

                        {/* Divider */}
                        <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginBottom: 8 }} />

                        {/* Top factors */}
                        {area.risk.factors.slice(0, 2).map((f, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span style={{ color: "#fca5a5", fontSize: 11, fontWeight: 700, minWidth: 24 }}>+{f.contribution}</span>
                            <span style={{ color: "#d1fae5", fontSize: 11 }}>{f.name}</span>
                          </div>
                        ))}

                        {/* Area info */}
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                          <span style={{ color: "#6ee7b7", fontSize: 10 }}>
                            {area.areaHectares?.toLocaleString("pt-BR")} ha
                          </span>
                          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>Simulado</span>
                        </div>
                      </div>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}

              <FlyToArea area={selectedArea} />
            </MapContainer>
          </div>

          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Info className="w-3 h-3" />
            Polígonos de biomas são aproximações visuais. Posições das áreas são demonstrativas.
            Clique em um marcador para detalhes ou use o painel lateral.
          </p>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          {selectedArea ? (
            <div className="bg-card border border-border/50 rounded-2xl p-5 shadow-sm">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold text-foreground">{selectedArea.name}</h3>
                  <p className="text-xs text-muted-foreground">{selectedArea.municipality}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    🌿 Bioma: <span className="font-medium">{selectedArea.biome}</span>
                  </p>
                </div>
                <button onClick={() => setSelectedArea(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-3 mb-4">
                <div className="text-center">
                  <p className="text-3xl font-bold" style={{ color: riskLevelColor(selectedArea.risk.level) }}>
                    {selectedArea.risk.score}
                  </p>
                  <p className="text-xs text-muted-foreground">/100</p>
                </div>
                <div>
                  <RiskBadge level={selectedArea.risk.level} size="md" />
                  <p className="text-xs text-muted-foreground mt-1">{riskLevelDescription(selectedArea.risk.level)}</p>
                </div>
              </div>

              <div className="space-y-2 mb-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Operação</span>
                  <span className="font-medium">{selectedArea.operationType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Área</span>
                  <span className="font-medium">{selectedArea.areaHectares?.toLocaleString("pt-BR")} ha</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bioma</span>
                  <span className="font-medium">{selectedArea.biome}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Confiança</span>
                  <span className="font-medium">{Math.round(selectedArea.risk.confidence * 100)}%</span>
                </div>
              </div>

              {selectedArea.risk.factors.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Fatores críticos</p>
                  <div className="space-y-1">
                    {selectedArea.risk.factors.slice(0, 3).map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-bold text-red-600">+{f.contribution}</span>
                        <span>{f.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedArea.isSimulated && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-4">
                  {SIMULATED_DATA_LABEL}
                </p>
              )}

              <div className="space-y-2">
                <Button size="sm" className="w-full" onClick={() => setLocation("/simulacao")}>
                  <Flame className="w-4 h-4 mr-2" /> Nova análise
                </Button>
                <Button variant="outline" size="sm" className="w-full" onClick={() => setLocation("/alerts")}>
                  <Bell className="w-4 h-4 mr-2" /> Ver alertas
                </Button>
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setLocation("/reports")}>
                  <FileText className="w-4 h-4 mr-2" /> Gerar relatório
                </Button>
              </div>
            </div>
          ) : (
            <div className="bg-card border border-border/50 rounded-2xl p-5 shadow-sm text-center">
              <MapPin className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm font-semibold text-muted-foreground">Clique em uma área no mapa</p>
              <p className="text-xs text-muted-foreground/60 mt-1">para ver detalhes, índice, bioma e recomendações.</p>
            </div>
          )}

          {/* Area list */}
          <div className="bg-card border border-border/50 rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-muted-foreground mb-3">
              Áreas no mapa ({filteredAreas.length})
            </p>
            <div className="space-y-2">
              {filteredAreas.map(a => (
                <button
                  key={a.id}
                  onClick={() => setSelectedArea(prev => prev?.id === a.id ? null : a)}
                  className={cn(
                    "w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-colors",
                    selectedArea?.id === a.id ? "bg-primary/10" : "hover:bg-muted/30"
                  )}
                >
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: riskLevelColor(a.risk.level) }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{a.biome} · {a.operationType}</p>
                  </div>
                  <span className="text-xs font-bold shrink-0" style={{ color: riskLevelColor(a.risk.level) }}>
                    {a.risk.score}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Biome quick legend */}
          <div className="bg-card border border-border/50 rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-muted-foreground mb-3">Biomas do Brasil</p>
            <div className="space-y-2">
              {(Object.entries(BIOME_COLORS) as [BrazilianBiome, string][]).map(([biome, color]) => (
                <div key={biome} className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-foreground">{biome}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {DECISION_SUPPORT_DISCLAIMER}
          </div>
        </div>
      </div>
    </Layout>
  );
}
