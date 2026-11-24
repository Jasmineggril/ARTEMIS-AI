/**
 * Motor Transparente de Classificação de Risco de Incêndio
 *
 * Este motor baseado em regras documentadas é utilizado para demonstração e
 * validação do fluxo tecnológico em ambiente controlado. A Prova de Valor
 * prevê treinamento, calibração e validação de modelo supervisionado com
 * dados representativos.
 *
 * NÃO é Machine Learning supervisionado treinado. É um motor determinístico
 * baseado em regras, separado da interface e preparado para futura
 * substituição por modelo supervisionado.
 *
 * Versão: 1.1.0 (paridade com python_service/risk_model.py — ver docs/artemis/17_METODOLOGIA_RISCO.md)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type RiskLevel = "baixo" | "moderado" | "alto" | "crítico";

export interface RiskInput {
  /** Temperatura do ar em °C */
  temperature: number;
  /** Umidade relativa do ar em % (0–100) */
  humidity: number;
  /** Velocidade do vento em km/h */
  windSpeed: number;
  /** Precipitação nas últimas 72 horas em mm */
  recentRainfall: number;
  /** Condição da vegetação: 0=muito seca, 1=seca, 2=moderada, 3=úmida */
  vegetationCondition: 0 | 1 | 2 | 3;
  /** Existe foco próximo registrado? */
  nearbyHotspot: boolean;
  /** Distância estimada do foco mais próximo em km (0 se sem foco) */
  hotspotDistance: number;
  /** Número de ocorrências históricas na área */
  historicalOccurrences: number;
  /** Qualidade dos dados: 0=ruim, 1=regular, 2=boa, 3=excelente */
  dataQuality: 0 | 1 | 2 | 3;
}

export interface RiskFactor {
  name: string;
  description: string;
  contribution: number; // pontos adicionados ao score
  value: string;        // valor observado formatado
  weight: "alto" | "médio" | "baixo";
}

export interface RiskRecommendation {
  priority: "imediata" | "urgente" | "preventiva" | "monitoramento";
  action: string;
  rationale: string;
}

export interface RiskResult {
  score: number;          // 0–100
  level: RiskLevel;
  confidence: number;     // 0–1, baseado na qualidade dos dados
  factors: RiskFactor[];
  recommendations: RiskRecommendation[];
  calculationVersion: string;
  isSimulated: boolean;
  calculatedAt: string;   // ISO 8601
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ENGINE_VERSION = "1.1.0";

// Thresholds para classificação de nível
const LEVEL_THRESHOLDS = {
  baixo:    { min: 0,  max: 24 },
  moderado: { min: 25, max: 49 },
  alto:     { min: 50, max: 74 },
  crítico:  { min: 75, max: 100 },
} as const;

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateRiskInput(input: Partial<RiskInput>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (input.temperature === undefined || input.temperature === null) {
    errors.push("Temperatura é obrigatória.");
  } else if (input.temperature < -20 || input.temperature > 60) {
    warnings.push(`Temperatura fora de faixa esperada: ${input.temperature}°C`);
  }

  if (input.humidity === undefined || input.humidity === null) {
    errors.push("Umidade é obrigatória.");
  } else if (input.humidity < 0 || input.humidity > 100) {
    errors.push(`Umidade inválida: ${input.humidity}%. Deve estar entre 0 e 100.`);
  }

  if (input.windSpeed === undefined || input.windSpeed === null) {
    errors.push("Velocidade do vento é obrigatória.");
  } else if (input.windSpeed < 0) {
    errors.push("Velocidade do vento não pode ser negativa.");
  } else if (input.windSpeed > 200) {
    warnings.push(`Velocidade do vento muito alta: ${input.windSpeed} km/h`);
  }

  if (input.recentRainfall === undefined || input.recentRainfall === null) {
    errors.push("Precipitação recente é obrigatória.");
  } else if (input.recentRainfall < 0) {
    errors.push("Precipitação não pode ser negativa.");
  }

  if (![0, 1, 2, 3].includes(input.vegetationCondition as number)) {
    errors.push("Condição da vegetação deve ser 0, 1, 2 ou 3.");
  }

  if (input.hotspotDistance !== undefined && input.hotspotDistance < 0) {
    errors.push("Distância do foco não pode ser negativa.");
  }

  if (input.historicalOccurrences !== undefined && input.historicalOccurrences < 0) {
    errors.push("Ocorrências históricas não podem ser negativas.");
  }

  if (![0, 1, 2, 3].includes(input.dataQuality as number)) {
    errors.push("Qualidade dos dados deve ser 0, 1, 2 ou 3.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Normalization ───────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalize(value: number, min: number, max: number): number {
  return clamp((value - min) / (max - min), 0, 1);
}

// ─── Score calculation ───────────────────────────────────────────────────────

/**
 * Calcula o índice de risco de 0 a 100.
 *
 * Pesos dos fatores (soma máxima sem reductions = 100):
 *   temperatura         → até 20 pts
 *   umidade             → até 20 pts
 *   vento               → até 15 pts
 *   chuva recente       → até -15 pts (redução)
 *   vegetação           → até 15 pts
 *   foco próximo        → até 20 pts
 *   histórico           → até 10 pts
 */
function calculateScore(input: RiskInput): { score: number; factors: RiskFactor[] } {
  const factors: RiskFactor[] = [];
  let score = 0;

  // 1. Temperatura (0–20 pts)
  let tempPts = 0;
  if (input.temperature >= 40) {
    tempPts = 20;
    factors.push({
      name: "Temperatura extrema",
      description: "Temperatura muito elevada aumenta a taxa de evaporação e resseca a vegetação.",
      contribution: tempPts,
      value: `${input.temperature}°C`,
      weight: "alto",
    });
  } else if (input.temperature >= 35) {
    tempPts = 15;
    factors.push({
      name: "Temperatura muito alta",
      description: "Temperatura acima de 35°C eleva significativamente o risco.",
      contribution: tempPts,
      value: `${input.temperature}°C`,
      weight: "alto",
    });
  } else if (input.temperature >= 30) {
    tempPts = 8;
    factors.push({
      name: "Temperatura alta",
      description: "Temperatura elevada contribui para ressecamento da vegetação.",
      contribution: tempPts,
      value: `${input.temperature}°C`,
      weight: "médio",
    });
  } else if (input.temperature >= 25) {
    tempPts = 3;
    factors.push({
      name: "Temperatura moderada",
      description: "Temperatura dentro de faixa de atenção.",
      contribution: tempPts,
      value: `${input.temperature}°C`,
      weight: "baixo",
    });
  }
  score += tempPts;

  // 2. Umidade (0–20 pts)
  let humPts = 0;
  if (input.humidity < 20) {
    humPts = 20;
    factors.push({
      name: "Umidade criticamente baixa",
      description: "Umidade abaixo de 20% é condição de alerta máximo para incêndios.",
      contribution: humPts,
      value: `${input.humidity}%`,
      weight: "alto",
    });
  } else if (input.humidity < 30) {
    humPts = 15;
    factors.push({
      name: "Umidade muito baixa",
      description: "Umidade abaixo de 30% facilita a propagação de incêndios.",
      contribution: humPts,
      value: `${input.humidity}%`,
      weight: "alto",
    });
  } else if (input.humidity < 50) {
    humPts = 8;
    factors.push({
      name: "Umidade baixa",
      description: "Umidade reduzida aumenta o potencial de ignição.",
      contribution: humPts,
      value: `${input.humidity}%`,
      weight: "médio",
    });
  } else if (input.humidity < 65) {
    humPts = 3;
    factors.push({
      name: "Umidade moderada",
      description: "Nível de umidade aceitável, mas requer monitoramento.",
      contribution: humPts,
      value: `${input.humidity}%`,
      weight: "baixo",
    });
  }
  score += humPts;

  // 3. Vento (0–15 pts)
  let windPts = 0;
  if (input.windSpeed > 40) {
    windPts = 15;
    factors.push({
      name: "Vento muito forte",
      description: "Vento acima de 40 km/h acelera dramaticamente a propagação.",
      contribution: windPts,
      value: `${input.windSpeed} km/h`,
      weight: "alto",
    });
  } else if (input.windSpeed > 25) {
    windPts = 10;
    factors.push({
      name: "Vento forte",
      description: "Vento elevado favorece a propagação de incêndios.",
      contribution: windPts,
      value: `${input.windSpeed} km/h`,
      weight: "alto",
    });
  } else if (input.windSpeed > 15) {
    windPts = 5;
    factors.push({
      name: "Vento moderado",
      description: "Vento moderado pode facilitar a propagação em áreas secas.",
      contribution: windPts,
      value: `${input.windSpeed} km/h`,
      weight: "médio",
    });
  }
  score += windPts;

  // 4. Chuva recente (redução de até 15 pts)
  let rainPts = 0;
  if (input.recentRainfall > 30) {
    rainPts = -15;
    factors.push({
      name: "Chuva recente abundante",
      description: "Precipitação abundante reduz significativamente o risco.",
      contribution: rainPts,
      value: `${input.recentRainfall} mm`,
      weight: "alto",
    });
  } else if (input.recentRainfall > 10) {
    rainPts = -8;
    factors.push({
      name: "Chuva recente",
      description: "Precipitação recente atenua parcialmente o risco.",
      contribution: rainPts,
      value: `${input.recentRainfall} mm`,
      weight: "médio",
    });
  } else if (input.recentRainfall > 2) {
    rainPts = -3;
    factors.push({
      name: "Chuva leve recente",
      description: "Precipitação leve, redução mínima do risco.",
      contribution: rainPts,
      value: `${input.recentRainfall} mm`,
      weight: "baixo",
    });
  }
  score += rainPts;

  // 5. Condição da vegetação (0–15 pts)
  const vegMap: Record<number, { pts: number; label: string; desc: string; weight: RiskFactor["weight"] }> = {
    0: { pts: 15, label: "Vegetação muito seca",   desc: "Vegetação ressecada é combustível ideal para incêndios.", weight: "alto" },
    1: { pts: 10, label: "Vegetação seca",         desc: "Vegetação seca aumenta o potencial de ignição.", weight: "alto" },
    2: { pts: 4,  label: "Vegetação moderada",     desc: "Condição intermediária de umidade da vegetação.", weight: "médio" },
    3: { pts: 0,  label: "Vegetação úmida",        desc: "Vegetação úmida reduz o risco de ignição.", weight: "baixo" },
  };
  const veg = vegMap[input.vegetationCondition];
  if (veg.pts > 0) {
    factors.push({
      name: veg.label,
      description: veg.desc,
      contribution: veg.pts,
      value: veg.label,
      weight: veg.weight,
    });
  }
  score += veg.pts;

  // 6. Foco próximo (0–20 pts)
  let hotspotPts = 0;
  if (input.nearbyHotspot) {
    if (input.hotspotDistance <= 5) {
      hotspotPts = 20;
      factors.push({
        name: "Foco ativo muito próximo",
        description: `Foco de calor ou incêndio a ${input.hotspotDistance} km — risco de propagação imediata.`,
        contribution: hotspotPts,
        value: `${input.hotspotDistance} km`,
        weight: "alto",
      });
    } else if (input.hotspotDistance <= 15) {
      hotspotPts = 15;
      factors.push({
        name: "Foco ativo próximo",
        description: `Foco de calor ou incêndio a ${input.hotspotDistance} km — risco de propagação elevado.`,
        contribution: hotspotPts,
        value: `${input.hotspotDistance} km`,
        weight: "alto",
      });
    } else if (input.hotspotDistance <= 30) {
      hotspotPts = 8;
      factors.push({
        name: "Foco ativo na região",
        description: `Foco de calor ou incêndio a ${input.hotspotDistance} km — atenção recomendada.`,
        contribution: hotspotPts,
        value: `${input.hotspotDistance} km`,
        weight: "médio",
      });
    } else if (input.hotspotDistance <= 50) {
      hotspotPts = 4;
      factors.push({
        name: "Foco ativo distante",
        description: `Foco de calor ou incêndio a ${input.hotspotDistance} km — acompanhar a evolução.`,
        contribution: hotspotPts,
        value: `${input.hotspotDistance} km`,
        weight: "baixo",
      });
    }
  }
  score += hotspotPts;

  // 7. Histórico de ocorrências (0–10 pts)
  let histPts = 0;
  if (input.historicalOccurrences >= 5) {
    histPts = 10;
    factors.push({
      name: "Alto histórico de ocorrências",
      description: "Área com histórico frequente de incêndios.",
      contribution: histPts,
      value: `${input.historicalOccurrences} ocorrências`,
      weight: "médio",
    });
  } else if (input.historicalOccurrences >= 3) {
    histPts = 6;
    factors.push({
      name: "Histórico de ocorrências",
      description: "Área com registro de incêndios anteriores.",
      contribution: histPts,
      value: `${input.historicalOccurrences} ocorrências`,
      weight: "baixo",
    });
  } else if (input.historicalOccurrences >= 1) {
    histPts = 2;
    factors.push({
      name: "Ocorrência histórica",
      description: "Área com registro de ocorrência anterior.",
      contribution: histPts,
      value: input.historicalOccurrences === 1 ? "1 ocorrência" : `${input.historicalOccurrences} ocorrências`,
      weight: "baixo",
    });
  }
  score += histPts;

  // Limitar entre 0 e 100
  score = Math.round(clamp(score, 0, 100));
  return { score, factors };
}

// ─── Level classification ─────────────────────────────────────────────────────

export function scoreToLevel(score: number): RiskLevel {
  if (score >= LEVEL_THRESHOLDS.crítico.min) return "crítico";
  if (score >= LEVEL_THRESHOLDS.alto.min) return "alto";
  if (score >= LEVEL_THRESHOLDS.moderado.min) return "moderado";
  return "baixo";
}

// ─── Recommendations ──────────────────────────────────────────────────────────

function buildRecommendations(level: RiskLevel, input: RiskInput): RiskRecommendation[] {
  const recs: RiskRecommendation[] = [];

  if (level === "baixo") {
    recs.push({
      priority: "monitoramento",
      action: "Manter monitoramento periódico das condições ambientais.",
      rationale: "Risco baixo não exige ação imediata, mas o monitoramento contínuo é recomendado.",
    });
    recs.push({
      priority: "preventiva",
      action: "Verificar estado dos aceiros e equipamentos de combate.",
      rationale: "Manutenção preventiva garante prontidão em caso de mudança nas condições.",
    });
  }

  if (level === "moderado") {
    recs.push({
      priority: "preventiva",
      action: "Intensificar frequência de monitoramento e inspeção de campo.",
      rationale: "Condições moderadas podem evoluir rapidamente com mudança climática.",
    });
    recs.push({
      priority: "preventiva",
      action: "Revisar e reforçar aceiros existentes ao redor das áreas críticas.",
      rationale: "Barreiras físicas reduzem a velocidade de propagação em caso de ignição.",
    });
    recs.push({
      priority: "preventiva",
      action: "Alertar equipes locais sobre condições de risco moderado.",
      rationale: "Comunicação antecipada reduz tempo de resposta.",
    });
  }

  if (level === "alto") {
    recs.push({
      priority: "urgente",
      action: "Acionar protocolo de prontidão — equipes em estado de alerta.",
      rationale: "Risco alto exige prontidão imediata para resposta rápida.",
    });
    recs.push({
      priority: "urgente",
      action: "Restringir atividades geradoras de faíscas ou fogo na área.",
      rationale: "Eliminação de fontes de ignição reduz probabilidade de ocorrência.",
    });
    recs.push({
      priority: "urgente",
      action: "Verificar disponibilidade de equipamentos e rotas de acesso.",
      rationale: "Garantir capacidade de resposta antes da ocorrência.",
    });
    recs.push({
      priority: "preventiva",
      action: "Intensificar comunicação com órgãos competentes (Bombeiros, IBAMA, defesa civil).",
      rationale: "Coordenação prévia com autoridades agiliza resposta emergencial.",
    });
  }

  if (level === "crítico") {
    recs.push({
      priority: "imediata",
      action: "ACIONAR IMEDIATAMENTE brigada de incêndio e protocolo de emergência.",
      rationale: "Risco crítico exige ação imediata sem aguardar confirmação adicional.",
    });
    recs.push({
      priority: "imediata",
      action: "Comunicar Bombeiros, IBAMA e Defesa Civil sobre condição crítica.",
      rationale: "Autoridades devem ser informadas para coordenar resposta adequada.",
    });
    recs.push({
      priority: "imediata",
      action: "Suspender todas as atividades produtivas nas áreas de risco.",
      rationale: "Proteção de pessoas e ativos tem prioridade absoluta.",
    });
    recs.push({
      priority: "imediata",
      action: "Evacuar áreas vulneráveis e isolar perímetro de risco.",
      rationale: "Segurança humana é a primeira prioridade em situação crítica.",
    });
    recs.push({
      priority: "urgente",
      action: "Documentar todas as ações tomadas para fins de auditoria e seguro.",
      rationale: "Registro adequado apoia processos de regularização e indenização.",
    });
  }

  if (input.nearbyHotspot && input.hotspotDistance <= 10) {
    recs.push({
      priority: "imediata",
      action: `Monitorar evolução do foco a ${input.hotspotDistance} km — avaliar trajetória com apoio de sobrevoo ou câmera remota.`,
      rationale: "Foco próximo pode atingir a área monitorada rapidamente dependendo do vento.",
    });
  }

  if (input.windSpeed > 30) {
    recs.push({
      priority: "urgente",
      action: `Considerar vento de ${input.windSpeed} km/h como fator de propagação — revisar direção dos aceiros.`,
      rationale: "Vento forte pode mudar rapidamente a direção de propagação.",
    });
  }

  return recs;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Calcula o índice de risco de incêndio com base nos dados de entrada.
 *
 * Retorna RiskResult com score (0–100), nível, fatores explicados e recomendações.
 * É determinístico: mesmas entradas sempre produzem o mesmo resultado.
 *
 * @param input - Dados ambientais e operacionais da área
 * @param isSimulated - Indica se os dados são simulados (para rotulagem)
 * @returns RiskResult
 * @throws Error se os dados de entrada forem inválidos
 */
export function calculateRisk(input: RiskInput, isSimulated = false): RiskResult {
  const validation = validateRiskInput(input);
  if (!validation.valid) {
    throw new Error(`Dados inválidos: ${validation.errors.join("; ")}`);
  }

  const { score, factors } = calculateScore(input);
  const level = scoreToLevel(score);
  const recommendations = buildRecommendations(level, input);

  // Confiança baseada na qualidade dos dados
  const confidenceMap: Record<number, number> = { 0: 0.5, 1: 0.65, 2: 0.8, 3: 0.95 };
  const confidence = confidenceMap[input.dataQuality] ?? 0.65;

  return {
    score,
    level,
    confidence,
    factors,
    recommendations,
    calculationVersion: ENGINE_VERSION,
    isSimulated,
    calculatedAt: new Date().toISOString(),
  };
}

// ─── Preset scenarios ─────────────────────────────────────────────────────────

/** Cenários demonstrativos pré-configurados */
export const DEMO_SCENARIOS: Record<string, { label: string; input: RiskInput }> = {
  baixo: {
    label: "Cenário Baixo",
    input: {
      temperature: 24,
      humidity: 78,
      windSpeed: 8,
      recentRainfall: 25,
      vegetationCondition: 3,
      nearbyHotspot: false,
      hotspotDistance: 0,
      historicalOccurrences: 0,
      dataQuality: 2,
    },
  },
  moderado: {
    label: "Cenário Moderado",
    input: {
      temperature: 33,
      humidity: 45,
      windSpeed: 18,
      recentRainfall: 5,
      vegetationCondition: 2,
      nearbyHotspot: false,
      hotspotDistance: 0,
      historicalOccurrences: 3,
      dataQuality: 2,
    },
  },
  alto: {
    label: "Cenário Alto",
    input: {
      temperature: 38,
      humidity: 28,
      windSpeed: 28,
      recentRainfall: 0,
      vegetationCondition: 1,
      nearbyHotspot: true,
      hotspotDistance: 20,
      historicalOccurrences: 3,
      dataQuality: 2,
    },
  },
  crítico: {
    label: "Cenário Crítico",
    input: {
      temperature: 42,
      humidity: 15,
      windSpeed: 45,
      recentRainfall: 0,
      vegetationCondition: 0,
      nearbyHotspot: true,
      hotspotDistance: 4,
      historicalOccurrences: 6,
      dataQuality: 2,
    },
  },
};

// ─── Utility exports ──────────────────────────────────────────────────────────

export { LEVEL_THRESHOLDS };
