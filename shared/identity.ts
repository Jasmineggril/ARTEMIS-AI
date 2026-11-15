/**
 * Controle centralizado de identidade da plataforma.
 *
 * Quando VITE_SUBMISSION_MODE=true, nenhum dado pessoal, nome de empresa,
 * e-mail, LinkedIn ou informação que identifique os proponentes é exibido.
 */

export const SUBMISSION_MODE =
  typeof import.meta !== "undefined" &&
  (import.meta as any).env?.VITE_SUBMISSION_MODE === "true";

export const PRODUCT_NAME = SUBMISSION_MODE
  ? "Plataforma Preditiva de Inteligência Ambiental"
  : "ARTEMIS AI";

export const PRODUCT_SUBTITLE = SUBMISSION_MODE
  ? "Prevenção de incêndios em áreas produtivas e ativos territoriais."
  : "Inteligência ambiental para prevenção de incêndios";

export const PRODUCT_TAGLINE = "Inteligência para antecipar riscos. Tecnologia para proteger territórios.";

/** Integrated modules (history and traceability of the previous projects). */
export const MODULE_PREDICTIVE = "CERES AI";      // predictive risk analysis
export const MODULE_MONITORING = "Florestaí";     // accessible public monitoring

export const EMERGENCY_NOTICE =
  "A ARTEMIS AI não é um serviço de emergência. Em caso de incêndio ou perigo imediato, ligue 193 (Corpo de Bombeiros) ou 199 (Defesa Civil).";

export const PRODUCT_DESCRIPTION =
  "A plataforma integra dados ambientais, climáticos e geoespaciais para classificar riscos de incêndio, identificar áreas críticas, explicar fatores de risco e gerar alertas e recomendações preventivas.";

export const SIMULATED_DATA_LABEL =
  "Dados simulados para demonstração em ambiente controlado.";

export const DECISION_SUPPORT_DISCLAIMER =
  "Esta análise é um instrumento de apoio à decisão e não substitui inspeção, laudo técnico ou protocolo oficial de segurança.";

export const TRL_LABEL = "Protótipo em validação controlada — TRL 4";
