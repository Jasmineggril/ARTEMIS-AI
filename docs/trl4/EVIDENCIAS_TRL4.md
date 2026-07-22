# Evidências de TRL 4 — Plataforma Preditiva de Inteligência Ambiental

**Data:** Julho 2026  
**Versão do Motor:** 1.0.0  
**Nível:** TRL 4 — Protótipo funcional em ambiente controlado  

---

## Checklist de Evidências TRL 4

### 1. Arquitetura definida

- [x] Stack tecnológico documentado (React 18, Node.js, Express, Drizzle ORM, PostgreSQL)
- [x] Separação entre motor de risco (`shared/risk-engine.ts`) e interface
- [x] API REST com rotas documentadas em `shared/routes.ts`
- [x] Schema de banco de dados versionado (`shared/schema.ts`)
- [x] Motor isolado e preparado para futura substituição por modelo supervisionado

### 2. Componentes integrados e testados

- [x] Motor de classificação de risco (v1.0.0) — baseado em regras documentadas
- [x] Interface React completa com todas as telas previstas
- [x] API de dados climáticos reais (Open-Meteo) integrada
- [x] Sistema de alertas com severidades e resolução
- [x] Autenticação com email e senha
- [x] Painel de monitoramento com gráficos
- [x] Mapa georreferenciado com marcadores por nível de risco
- [x] Relatórios de análise com campos de validação técnica

### 3. Testes automatizados

**Executados em 17/07/2026 — evidência real:**

- [x] 34 testes do motor de risco (`tests/risk-engine.test.ts`) — `npm run test:risk` → **34 passaram · 0 falharam**
- [x] 10 testes de autenticação (`tests/auth.test.ts`) — `npm run test:auth` → **10 passaram · 0 falharam**
- [x] Cobertura dos 4 cenários (Baixo/Moderado/Alto/Crítico)
- [x] Testes de entradas inválidas e valores extremos
- [x] Verificação de determinismo (mesma entrada = mesmo resultado)
- [x] Validação dos campos `calculatedAt`, `isSimulated`, `calculationVersion`
- [x] TypeScript sem erros — `npm run check` → saída limpa
- [x] Build de produção sem falhas — `npm run build` → `dist/` gerado, 8s

### 4. Dados identificados corretamente

- [x] Dados simulados rotulados na interface como "Dados simulados para demonstração em ambiente controlado."
- [x] API Open-Meteo identificada como fonte de dados reais
- [x] Motor de risco identificado como baseado em regras (não ML supervisionado)
- [x] Nível TRL 4 exibido na interface

### 5. Funcionalidades demonstráveis

- [x] Análise preditiva com entrada manual de dados ambientais
- [x] Classificação de risco em 4 níveis com score 0–100
- [x] Explicação dos fatores que influenciaram o resultado
- [x] Recomendações preventivas por nível de risco
- [x] Mapa de risco com filtros por nível e setor
- [x] Alertas preventivos com gestão de status
- [x] Gráficos de evolução e distribuição de risco
- [x] Protocolos de prevenção com checklists interativos
- [x] Relatórios de análise com espaço para validação técnica

---

## O que NÃO está implementado (previsto para PoV)

- [ ] Modelo supervisionado treinado com dados representativos
- [ ] Integração com sensores físicos reais de campo
- [ ] Integração com INPE (API de focos de incêndio em tempo real)
- [ ] Integração com MapBiomas (cobertura e uso da terra)
- [ ] Exportação de relatórios em PDF nativo
- [ ] Autenticação com 2FA
- [ ] Alertas via SMS/WhatsApp

---

## Limitações declaradas

1. **Motor baseado em regras:** O motor v1.0.0 usa regras documentadas, não modelo supervisionado treinado. Os thresholds são baseados em literatura técnica, não em dados históricos representativos do setor.

2. **Dados simulados:** Áreas monitoradas, histórico de ocorrências e focos próximos são simulados para fins de demonstração.

3. **Localização aproximada:** As coordenadas das áreas demonstrativas são aproximadas.

4. **Autenticação em produção:** Senhas novas protegidas com bcrypt; hashes SHA-256 legados são migrados automaticamente no primeiro login.

5. **Exportação PDF:** Realizada via diálogo de impressão do navegador, não via geração nativa de PDF.
