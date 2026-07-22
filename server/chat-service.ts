/**
 * Serviço de chat com IA para a Plataforma Preditiva de Inteligência Ambiental.
 * Usa a API OpenAI (GPT-4o-mini) com fallback para respostas offline.
 *
 * O assistente está sempre disponível — se a API OpenAI falhar, o fallback
 * offline garante que as perguntas sejam respondidas sem interrupção.
 */

const SYSTEM_PROMPT = `Você é um especialista em prevenção de incêndios em áreas produtivas e ativos territoriais, integrado à Plataforma Preditiva de Inteligência Ambiental (TRL 4).

Sua função é ajudar usuários a:
- Entender o índice de risco de incêndio calculado pelo motor da plataforma (0–100, níveis: Baixo/Moderado/Alto/Crítico)
- Interpretar os fatores que influenciam o risco (temperatura, umidade, vento, vegetação, focos próximos, histórico)
- Compreender e aplicar os protocolos de prevenção por nível de risco
- Tomar decisões preventivas para proteger áreas produtivas (agroindústria, energia, mineração, empresas florestais, logística)
- Entender conceitos de risco ambiental e manejo preventivo de incêndios

REGRAS:
- Seja objetivo e prático — o usuário precisa de orientação operacional
- Destaque que os resultados são instrumentos de apoio à decisão e não substituem inspeção técnica presencial
- Para risco Crítico: sempre enfatize que Bombeiros (193), IBAMA e Defesa Civil devem ser acionados imediatamente
- Identifique claramente quando dados são simulados (para demonstração em TRL 4)
- Não forneça informações médicas, jurídicas ou financeiras específicas
- Responda sempre em português do Brasil
- Seja conciso — respostas de até 3 parágrafos exceto quando uma lista estruturada for necessária

SOBRE O MOTOR DE RISCO:
- Versão: 1.0.0
- Método: baseado em regras documentadas (não é ML supervisionado treinado)
- Fatores: temperatura, umidade relativa, velocidade do vento, precipitação 72h, condição da vegetação, foco próximo, histórico de ocorrências
- Limiares: 0–24 Baixo, 25–49 Moderado, 50–74 Alto, 75–100 Crítico
- TRL 4: protótipo funcional em validação controlada`;

// Fallback offline para quando a API não estiver disponível
const OFFLINE_RESPONSES: { keywords: string[]; response: string }[] = [
  {
    keywords: ["risco", "índice", "score", "pontuação"],
    response: "O índice de risco é calculado de 0 a 100 com base em temperatura, umidade, vento, precipitação recente, condição da vegetação, presença de focos próximos e histórico de ocorrências. Níveis: 0–24 Baixo, 25–49 Moderado, 50–74 Alto, 75–100 Crítico.",
  },
  {
    keywords: ["crítico", "emergência", "bombeiro", "evacuar"],
    response: "Risco Crítico exige ação imediata: acione a brigada de incêndio, ligue 193 (Bombeiros), comunique o IBAMA e a Defesa Civil, suspenda atividades produtivas e evacue áreas vulneráveis. Documente todas as ações tomadas.",
  },
  {
    keywords: ["alto", "prontidão", "alerta"],
    response: "Risco Alto: acione o protocolo de prontidão, restrinja atividades geradoras de faíscas, verifique equipamentos de combate e intensifique comunicação com órgãos competentes.",
  },
  {
    keywords: ["moderado", "prevenir", "monitorar"],
    response: "Risco Moderado: intensifique o monitoramento de campo, reforce aceiros nas zonas críticas e alerte equipes locais sobre as condições.",
  },
  {
    keywords: ["baixo", "normal"],
    response: "Risco Baixo: mantenha monitoramento periódico, verifique aceiros e equipamentos de combate, e registre condições observadas para o histórico.",
  },
  {
    keywords: ["temperatura", "calor"],
    response: "A temperatura é um dos principais fatores de risco. Acima de 35°C: +15 pts. Acima de 40°C: +20 pts. Alta temperatura aumenta a taxa de evaporação e resseca a vegetação.",
  },
  {
    keywords: ["umidade", "seca"],
    response: "Umidade abaixo de 20% representa condição de alerta máximo (+20 pts). Abaixo de 30% (+15 pts), abaixo de 50% (+8 pts). Baixa umidade é o fator mais crítico para propagação de incêndios.",
  },
  {
    keywords: ["vento", "vento forte"],
    response: "Vento acima de 40 km/h adiciona 15 pontos ao índice. Acima de 25 km/h: +10 pts, acima de 15 km/h: +5 pts. Vento forte acelera dramaticamente a propagação e pode mudar sua direção.",
  },
  {
    keywords: ["simulação", "demo", "cenário", "dados simulados"],
    response: "Os dados simulados são identificados na plataforma com o rótulo 'Dados simulados para demonstração em ambiente controlado.' Isso é esperado para TRL 4 — os dados reais serão integrados durante a Prova de Valor.",
  },
  {
    keywords: ["trl", "protótipo", "maturidade"],
    response: "A plataforma está em TRL 4 — protótipo funcional com componentes integrados e testados em ambiente controlado. A validação em ambiente operacional real está prevista para a Prova de Valor (60 dias).",
  },
];

function getOfflineResponse(message: string): string {
  const lower = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const entry of OFFLINE_RESPONSES) {
    if (entry.keywords.some(k => lower.includes(k.normalize("NFD").replace(/[\u0300-\u036f]/g, "")))) {
      return entry.response;
    }
  }
  return "Sou o Assistente da Plataforma Preditiva de Inteligência Ambiental. Posso ajudar com dúvidas sobre o índice de risco, fatores ambientais, protocolos de prevenção e como usar a plataforma. Qual é sua pergunta?";
}

export type PropertyProfile = {
  municipality?: string;
  state?: string;
  biome?: string;
  propertySize?: string;
};

function buildProfileSection(profile: PropertyProfile): string {
  const lines: string[] = [];
  if (profile.municipality || profile.state) {
    const loc = [profile.municipality, profile.state].filter(Boolean).join(" – ");
    lines.push(`Município/Estado da propriedade: ${loc}`);
  }
  if (profile.biome) {
    lines.push(`Bioma predominante: ${profile.biome}`);
  }
  if (profile.propertySize) {
    lines.push(`Tamanho da propriedade: ${profile.propertySize}`);
  }
  if (lines.length === 0) return "";
  return (
    "\n\nPERFIL DA PROPRIEDADE DO USUÁRIO (contexto acumulado da conversa — use sempre que relevante):\n" +
    lines.map(l => `- ${l}`).join("\n")
  );
}

export async function getChatResponse(
  message: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  propertyProfile: PropertyProfile = {}
): Promise<{ response: string; usedFallback: boolean }> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return { response: getOfflineResponse(message), usedFallback: true };
  }

  const systemContent = SYSTEM_PROMPT + buildProfileSection(propertyProfile);

  try {
    const messages = [
      { role: "system", content: systemContent },
      ...history.slice(-8), // manter últimas 8 mensagens de contexto
      { role: "user", content: message },
    ];

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 600,
        temperature: 0.5,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[chat] OpenAI error:", res.status, err);
      return { response: getOfflineResponse(message), usedFallback: true };
    }

    const data = await res.json() as { choices: { message: { content: string } }[] };
    const reply = data.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return { response: getOfflineResponse(message), usedFallback: true };
    }

    return { response: reply, usedFallback: false };
  } catch (err) {
    console.error("[chat] fetch failed:", err);
    return { response: getOfflineResponse(message), usedFallback: true };
  }
}
