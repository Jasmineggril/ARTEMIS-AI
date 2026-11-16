/**
 * Synthetic ROI payloads shaped after Ibama's published documentation of
 * GET /api/v1/roi/publico. NOT captured from the live API (it was not
 * reachable from the development environment); replace with a real sample
 * once one is available.
 */
export function roi(n: number, over: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    numeroRoi: `ROI.TESTE.${n}`,
    statusRoi: "FINALIZADO",
    retificado: false,
    localIncendio: {
      latitude: -10.5 - n / 100,
      longitude: -48.3,
      municipio: { nomeMunicipio: "Palmas", unidadeFederativa: { siglaUnidadeFederativa: "TO" } },
      bioma: { nomeBioma: "Cerrado" },
    },
    dataInicioIncendio: "2026-08-12T14:30:00",
    dataDeteccaoIncendio: "2026-08-12T15:00:00",
    dataExtincaoIncendio: "2026-08-13T18:00:00",
    informacoesPosIncendio: { estimativaAreaQueimada: 12.5, vegetacoesAtingidas: [{ vegetacao: "Cerrado sentido restrito" }] },
    ...over,
  };
}

export function page(items: unknown[], pagina: number, totalPaginas: number) {
  return { pagina, tamanhoPagina: 500, totalItens: items.length * totalPaginas, totalPaginas, itens: items };
}
