# 20 — Dossiê de maturidade tecnológica (TRL)

**Data da avaliação:** 2026-11-17 · **Avaliação:** autoavaliação técnica, não auditada.

## Conclusão atual

> **A ARTEMIS AI está em TRL 6** — protótipo do sistema completo demonstrado em ambiente
> relevante (dados oficiais reais, build de produção, homologação HTTPS privada reproduzível).
> **TRL 7, 8 e 9 ainda não podem ser declarados**: dependem de operação na VPS, usuários
> reais e evidências acumuladas ao longo do tempo, que ainda não existem.
> A instrumentação para coletar essas evidências está pronta e testada.

Escala usada: definições NASA/ISO 16290 adaptadas a software.

## 1. Níveis, critérios e evidências

| TRL | Critério (software) | Situação | Evidências |
|---|---|---|---|
| 1 | Princípios básicos observados | ✅ | `00_DIAGNOSTICO.md`, `01_REQUISITOS.md` |
| 2 | Conceito tecnológico formulado | ✅ | `02_ARQUITETURA.md`, `08_PLANO_PROVA_DE_VALOR.md` |
| 3 | Prova de conceito analítica/experimental | ✅ | motor de regras + testes (`tests/risk-engine.test.ts`, `python_service/tests/`) |
| 4 | Componentes validados em laboratório | ✅ | testes unitários e de integração (API, banco, Sisfogo, produto, evidências) |
| 5 | Componentes validados em ambiente relevante | ✅ | conectores contra APIs reais: INPE Queimadas, Sisfogo (contrato real documentado em `11_SISFOGO.md`), Open-Meteo, IBGE |
| 6 | Sistema/protótipo demonstrado em ambiente relevante | ✅ (reforçado em 18/11: 2,65 M focos reais, PostGIS, backtest com 4 800 casos reais, resiliência 11/11 — `21`, `23`, `16` §4) | E2E de usuário real com dados reais (`tests/e2e/real-user.cjs`, capturas em `capturas/produto/`), homologação HTTPS (`14_HOMOLOGACAO_HOSTINGER.md`), segurança 28/28 e carga sem erros (`16_SEGURANCA_DESEMPENHO.md`), metodologia documentada (`17_METODOLOGIA_RISCO.md`) |
| 7 | Protótipo demonstrado em ambiente operacional | ⏳ não atingido | requer piloto na VPS — ver §3 |
| 8 | Sistema completo e qualificado em operação | ⏳ não atingido | requer piloto concluído + correções + produção aprovada |
| 9 | Sistema comprovado em operação real contínua | ⏳ não atingido | requer meses de operação com usuários reais |

## 2. Capacidades entregues (verificáveis no código)

- Contas, organizações, papéis e isolamento entre organizações (teste IDOR).
- Propriedades com polígono (desenho, GeoJSON/KML/SHP), validação geométrica no servidor.
- Mapa com focos INPE, ROIs Sisfogo, áreas e risco; filtros e legenda.
- Análise de risco com natureza dos dados e rastreabilidade; relatórios PDF/CSV.
- Alertas automáticos por foco detectado; agendador de sincronização com trava.
- Painel de administração da plataforma; painel "Operação e evidências" (`/admin/operacao`).
- Telemetria (heartbeat por minuto, latência/erros por rota), opiniões, SUS,
  avaliação de alertas por especialista, validação de desfechos, exportação de evidências.

## 3. Critérios de saída para os próximos níveis

### TRL 7 — piloto operacional
- [ ] Implantação na VPS Hostinger com domínio e HTTPS (**ação da responsável**: acesso, DNS, aprovação).
- [ ] 5–15 usuários reais convidados, ≥ 3 organizações, ≥ 8 semanas.
- [ ] Metas da tabela §5 do `18_PLANO_PILOTO_OPERACAO.md` atingidas ou desvios explicados.
- [ ] 8 exportações semanais de evidência arquivadas em `evidencias/`.
- [ ] Teste de restauração de backup na VPS registrado.

### TRL 8 — sistema qualificado
- [ ] Problemas S1/S2 do piloto corrigidos e reverificados.
- [x] Divergência Python × TypeScript resolvida (motor 1.1.0, diferença zero em 3 433 entradas — 18/11).
- [ ] Riscos residuais de dependências tratados (xlsx, zod 4) ou formalmente aceitos.
- [ ] Limiares revisados com os desfechos coletados (nova versão do motor, documentada). *Primeira evidência retrospectiva em `23`; decisão pendente.*
- [ ] Entrada em produção com **aprovação expressa** (`19_RUNBOOK_PRODUCAO.md` §2).
- [ ] Teste de segurança externo (ou revisão independente) sem achados críticos.

### TRL 9 — operação comprovada
- [ ] ≥ 6 meses em produção, incluindo uma estação seca completa.
- [ ] Disponibilidade ≥ 99,5 % medida, incidentes documentados com causa e correção.
- [ ] Uso recorrente por usuários fora do grupo piloto inicial.
- [ ] Pertinência dos alertas e desempenho do índice reportados com volume estatístico.
- [ ] Processo de suporte e atualizações funcionando (registros de chamados e versões).

## 4. Limitações conhecidas (declaradas)

1. Limiares do índice não calibrados com desfechos (ver `17_METODOLOGIA_RISCO.md` §5).
2. Vegetação informada pelo usuário; meteorologia de modelo em grade.
3. Carga medida em máquina local maior que a VPS prevista.
4. SMTP não configurado; recuperação de conta por link do administrador.
5. Sem monitor externo nem teste de intrusão independente.
6. Nenhum dado de usuário real ainda — todas as contas de teste são descartáveis e identificadas.

## 5. Pendências que dependem da responsável

| Pendência | Por quê |
|---|---|
| Acesso à VPS e execução de `scripts/ops/deploy-homolog.sh` | este ambiente não tem acesso à Hostinger |
| DNS do domínio apontando para a VPS | necessário para HTTPS |
| Credenciais SMTP (opcional) | e-mails de convite e recuperação |
| Seleção e convite dos participantes do piloto | usuários reais |
| Aprovação expressa para produção | regra do projeto |
| Revisão e merge do PR #4 | sem merge automático |

## 6. Histórico desta avaliação

| Data | Nível | Mudança |
|---|---|---|
| 2026-11-15 | 4 | componentes e testes de laboratório |
| 2026-11-17 | 6 | sistema completo com dados reais, homologação reproduzível, segurança e carga, instrumentação de evidências |
| 2026-11-18 | 6 | paridade dos motores, PostGIS, limites IBGE, notificações com registro de entrega, Prova de Valor instrumentada, backtest real, 2 falhas de resiliência corrigidas — **ainda TRL 6**: sem operação nem usuários reais |
