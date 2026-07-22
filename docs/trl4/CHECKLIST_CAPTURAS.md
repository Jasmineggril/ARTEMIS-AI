# Checklist de Capturas — Demonstração TRL 4

Capturas necessárias para evidenciar o funcionamento do protótipo.

## 1. Página inicial (Home)
- [ ] Hero com tagline "Preveja o risco. Proteja a operação."
- [ ] Badge TRL 4 visível
- [ ] Aviso de dados simulados visível
- [ ] 4 níveis de risco (Baixo/Moderado/Alto/Crítico) no hero
- [ ] Seção "Como funciona" com os 7 passos
- [ ] Seção de setores atendidos
- [ ] Seção TRL 4 com escala 1–9

## 2. Análise Preditiva (/simulacao)
- [ ] Formulário com todos os campos ambientais
- [ ] 4 botões de cenários demonstrativos
- [ ] Resultado com gauge de score (0–100)
- [ ] Badge de nível de risco
- [ ] Lista de fatores com contribuição (+/-)
- [ ] Recomendações preventivas por prioridade
- [ ] Aviso de dados simulados no resultado
- [ ] Disclaimer de apoio à decisão

## 3. Visão Geral — Dashboard (/dashboard)
- [ ] KPI cards: áreas, índice médio, alertas, fontes
- [ ] Bloco central com score e nível da área crítica
- [ ] Gráfico de evolução do score ao longo do dia
- [ ] Gráfico de distribuição por nível (semana)
- [ ] Fatores críticos identificados
- [ ] Tabela de áreas prioritárias
- [ ] Aviso de dados simulados

## 4. Áreas Monitoradas (/areas)
- [ ] Cards de contagem por nível de risco
- [ ] Tabela com score, nível, área (ha), última análise
- [ ] Filtro por nível de risco
- [ ] Busca por nome/município

## 5. Mapa de Risco (/maps)
- [ ] Mapa com 4 marcadores coloridos por nível
- [ ] Painel lateral com detalhes da área selecionada
- [ ] Filtros por nível e setor
- [ ] Legenda de cores
- [ ] Aviso de dados simulados

## 6. Inteligência Operacional (/insights)
- [ ] KPIs: total de análises, tempo médio, alertas emitidos, taxa de validação
- [ ] Gráfico de análises por período (stacked bar)
- [ ] Gráfico de distribuição por nível (pie)
- [ ] Gráfico de evolução do score (line)
- [ ] Gráfico de fatores mais frequentes (bar horizontal)
- [ ] Gráfico de alertas emitidos vs validados
- [ ] Status das fontes de dados

## 7. Alertas Preventivos (/alerts)
- [ ] Lista de alertas com severidade
- [ ] Filtros por tipo
- [ ] Botão de resolução de alerta

## 8. Protocolos de Prevenção (/prevention)
- [ ] 4 seções colapsáveis (Crítico, Alto, Moderado, Baixo)
- [ ] Ações recomendadas por nível
- [ ] Checklist interativo
- [ ] Disclaimer de referencial

## 9. Relatórios (/reports)
- [ ] Summary com contagens
- [ ] Relatório comparativo dos 4 cenários
- [ ] Relatório individual expandido com score, fatores, recomendações
- [ ] Espaço de validação técnica (assinatura)
- [ ] Botão de impressão

## 10. Assistente de Chat
- [ ] Botão flutuante visível
- [ ] Janela de chat com perguntas rápidas
- [ ] Resposta à pergunta sobre risco crítico
- [ ] Resposta à pergunta sobre fatores de risco
- [ ] Indicador "resposta offline" quando fallback

## 11. Testes automatizados
- [ ] Output do comando `npm run test:risk` mostrando 34/34 testes passando
