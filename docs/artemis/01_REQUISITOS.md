# 01 — Requisitos funcionais e não funcionais

Status por requisito: ✅ implementado e testado · 🟡 parcial · ⏳ pendente

## Requisitos funcionais

| ID | Requisito | Perfil | Status |
|---|---|---|---|
| RF01 | Cadastro com criação de organização e aceite da política de privacidade | todos | ✅ |
| RF02 | Login/logout com sessão no servidor | todos | ✅ |
| RF03 | Recuperação de senha por token temporário de uso único (30 min) | todos | 🟡 token e fluxo prontos; envio por e-mail pendente (SMTP) |
| RF04 | Papéis por organização: leitor, analista, gestor, administrador, proprietário | admin | ✅ |
| RF05 | Gestão de membros (adicionar, alterar papel, remover) | admin | ✅ |
| RF06 | Alternar organização ativa (usuário com várias) | todos | ✅ |
| RF07 | Cadastro de áreas: nome, atividade, município/UF, coordenadas, hectares, vegetação, limite GeoJSON, observações | gestor | ✅ |
| RF08 | Importação de limite por arquivo `.geojson` | gestor | ✅ (validação: Polygon/MultiPolygon, anel fechado, ≤ 5000 vértices) |
| RF09 | Análise de risco 0–100 com 4 níveis (0–24/25–49/50–74/75–100) | analista | ✅ |
| RF10 | Preenchimento meteorológico automático (Open-Meteo) apenas para campos vazios | analista | 🟡 implementado; não verificado contra a API real neste ambiente |
| RF11 | Ocorrências históricas da organização num raio de 10 km como fator | analista | ✅ |
| RF12 | Cada análise registra: índice, nível, data/hora, área, fontes, procedência por variável, qualidade, fatores, recomendações, limitações, motor e versão | analista | ✅ |
| RF13 | Histórico de análises por área | leitor | ✅ |
| RF14 | Alerta automático para nível ≥ `ALERT_MIN_LEVEL` (padrão: alto) | sistema | ✅ |
| RF15 | Deduplicação: reanálise no mesmo nível atualiza o alerta aberto | sistema | ✅ |
| RF16 | Ciclo de vida do alerta com histórico e responsável | analista | ✅ |
| RF17 | Importação CSV/XLS/XLSX: prévia → mapeamento → validação → duplicidades → confirmação → relatório | gestor | ✅ |
| RF18 | Revalidação no servidor e motivos de rejeição por lote | sistema | ✅ |
| RF19 | Mapa com áreas, polígonos, ocorrências e filtros (data, UF, município, nível) | leitor | 🟡 sem agrupamento, busca por endereço ou desenho de polígono |
| RF20 | Dashboard com indicadores da organização, fonte e data de atualização | leitor | ✅ |
| RF21 | Exportação CSV do histórico de análises | analista | ✅ |
| RF22 | Relatório PDF | analista | 🟡 via impressão do navegador |
| RF23 | Trilha de auditoria consultável | admin | ✅ |
| RF24 | Simulação pública sem login, rotulada como não armazenada | público | ✅ |
| RF25 | Canal de relatos ambientais com moderação | público | ⏳ endpoint legado protegido; módulo de moderação pendente |
| RF26 | Consulta Pública (`/consulta-publica`): consulta por UF/município/período/horário, mapa, gráficos por mês e hora, comparação de períodos, link compartilhável, conteúdo de prevenção e biomas | público | ✅ (dados apenas de lotes publicados por opção explícita) |
| RF27 | Notificações por e-mail com limite de frequência | sistema | ⏳ |
| RF28 | Módulo de Prova de Valor (área piloto, linha de base, métricas) | gestor | ⏳ plano em `08_PLANO_PROVA_DE_VALOR.md` |
| RF29 | Focos de calor INPE | sistema | ⏳ avaliar acesso e licença |

## Requisitos não funcionais

| ID | Requisito | Status |
|---|---|---|
| RNF01 | Senhas com bcrypt (12 rounds); política mínima 8 caracteres com letras e números | ✅ |
| RNF02 | Cookie de sessão `HttpOnly`, `Secure` (produção), `SameSite=Lax`, expiração 8 h renovável | ✅ |
| RNF03 | Sessão regenerada no login (anti-fixação) e destruída no logout | ✅ |
| RNF04 | Verificação de origem em requisições que alteram estado (CSRF, defesa em profundidade) | ✅ |
| RNF05 | Limitação de requisições: autenticação 10/15 min; redefinição 5/h; análise 30/min; chat 10/min | ✅ |
| RNF06 | Isolamento por organização verificado no servidor a cada requisição | ✅ |
| RNF07 | Validação estrita de entradas (zod, `.strict()`), limites de tamanho | ✅ |
| RNF08 | Cabeçalhos de segurança; CSP estrita em produção | ✅ |
| RNF09 | Erros 5xx sem detalhes internos; logs JSON sem corpos de requisição | ✅ |
| RNF10 | `SESSION_SECRET` obrigatório em produção (aplicação não inicia sem ele) | ✅ |
| RNF11 | Auditoria de operações críticas | ✅ |
| RNF12 | Nenhum dado inventado quando a fonte falha | ✅ |
| RNF13 | Acessibilidade WCAG 2.2 AA | 🟡 axe-core sem violações em 9 telas; auditoria manual (leitor de tela, teclado) pendente |
| RNF14 | Responsivo (celular, tablet, desktop) | 🟡 testado em celular e desktop; tablet não testado |
| RNF15 | Consumo compatível com VPS 2 vCPU / 8 GB | 🟡 limites definidos no Compose; teste de carga pendente |
| RNF16 | Backups criptografados externos com restauração testada | ✅ (scripts); agendamento e destino externo dependem da VPS |
| RNF17 | LGPD: política de privacidade, base legal, retenção, direitos | 🟡 minuta; revisão jurídica pendente |
