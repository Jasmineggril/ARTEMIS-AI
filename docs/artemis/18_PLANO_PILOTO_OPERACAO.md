# 18 — Plano de piloto controlado (rumo a TRL 7)

**Pré-requisitos (bloqueantes):** VPS com HTTPS publicada pelo script de homologação,
DNS configurado, SMTP configurado (ou convites manuais pelo admin), backup diário ativo,
e **autorização expressa da responsável** para liberar o acesso aos participantes.
Nenhum passo abaixo foi executado ainda.

## 1. Participantes

- 5 a 15 usuários selecionados: produtores rurais, gestores ambientais, brigadas/organizações.
- Pelo menos 3 organizações distintas e 2 biomas (ex.: Cerrado e Amazônia).
- Pelo menos 1 especialista em manejo do fogo para avaliar alertas.
- Convite individual pelo painel Admin; sem cadastro público.

## 2. Consentimento e privacidade

- Aceite da política de privacidade no cadastro (já obrigatório).
- Termo do piloto: dados de uso e opiniões serão usados, de forma agregada, como evidência
  de maturidade; o participante pode sair e pedir exclusão a qualquer momento.
- Nenhum dado pessoal sai do servidor; o pacote de evidências é agregado.

## 3. Integração dos participantes (1ª semana)

1. Convite → criação de senha → cadastro da propriedade com polígono (desenho ou importação KML/GeoJSON).
2. Primeira análise de risco acompanhada (registrar tempo de conclusão — `client_duration_ms`).
3. Explicar alertas, relatórios e o botão "Enviar opinião".

## 4. Duração e rotina

- **Mínimo de 8 semanas** contínuas, cobrindo preferencialmente parte da estação seca.
- Semanalmente o admin exporta `/api/admin/evidence.json` (últimos 7 dias) e salva em
  `docs/artemis/evidencias/AAAA-MM-DD/` (sem dados pessoais).
- Na semana 4 e na semana 8: questionário SUS (`/avaliacao`).
- Especialista avalia todos os alertas `foco_proximo` no painel de alertas.

## 5. Métricas e metas de saída do piloto

| Métrica | Fonte | Meta para considerar TRL 7 |
|---|---|---|
| Disponibilidade | heartbeats (`ops_heartbeats`) | ≥ 99,0 % no período |
| Erros 5xx | `ops_request_metrics` | ≤ 0,5 % das requisições da API |
| p95 da API | `ops_request_metrics` | ≤ 800 ms |
| Sincronizações INPE/Sisfogo | `source_sync_runs` | ≥ 95 % de sucesso; nenhuma fonte desatualizada > 26 h sem alerta ao admin |
| Usuários ativos | `audit_logs` | ≥ 70 % dos convidados ativos em ≥ 4 das 8 semanas |
| Tempo da análise | `client_duration_ms` | mediana ≤ 3 min |
| Usabilidade | SUS | média ≥ 68 com ≥ 8 respostas |
| Pertinência dos alertas | avaliações de especialista | ≥ 70 % pertinentes ou parcialmente, com ≥ 20 alertas avaliados |
| Problemas críticos | feedback + incidentes | zero abertos há mais de 7 dias |
| Perda de dados | backups/restauração | zero; 1 teste de restauração na VPS |

Metas não atingidas **não** são escondidas: entram no dossiê com análise da causa.

## 6. Incidentes e suporte

- Canal: botão "Enviar opinião" (categoria problema) + e-mail de suporte definido pela responsável.
- Severidade: **S1** indisponível/perda ou vazamento de dados (resposta < 4 h);
  **S2** função principal quebrada (< 1 dia útil); **S3** demais (< 1 semana).
- Todo S1/S2 gera registro em `docs/artemis/incidentes/` (o que, quando, impacto, causa, correção).
- Vazamento suspeito: suspender acesso, preservar logs, avisar a responsável e os afetados.

## 7. Correções durante o piloto

Seguem o processo de atualização controlada do `19_RUNBOOK_PRODUCAO.md`
(PR, testes, backup antes, janela comunicada, plano de retorno).
