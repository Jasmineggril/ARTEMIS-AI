# 22 — Prova de Valor (60 dias): metodologia, instrumentação e critérios de aceite

Alinhado ao cronograma da Prova de Valor (5 etapas). **Nenhum resultado de piloto existe ainda:**
os indicadores abaixo só podem ser medidos com avaliadores convidados, em ambiente operacional
autorizado pela responsável.

## 1. Indicadores e como são medidos

### I1 — Redução mínima de 30 % no tempo de análise

| Item | Definição |
|---|---|
| Tarefa | Para uma área: verificar focos próximos, condições do tempo e histórico, e concluir o nível de risco |
| Linha de base (sem a plataforma) | O avaliador faz a tarefa do modo habitual e cronometra em **Avaliação → Linha de base** (`/avaliacao/linha-de-base`); grava duração, início, área e fontes consultadas (`pov_baseline_measurements`, migração 0017) |
| Com a plataforma | Tempo entre abrir o formulário e obter o resultado, registrado automaticamente em cada análise (`risk_analyses.client_duration_ms`, migração 0013) |
| Exclusões | Análises com menos de 10 s não são humanas (testes automáticos) e ficam fora, **contadas**; medições manuais com menos de 10 s ou incoerentes com o horário são recusadas |
| Cálculo | redução = 1 − mediana(plataforma) / mediana(manual); também por avaliador (pares) |
| Amostra mínima | 10 medições manuais **e** 10 análises; abaixo disso o painel mostra "amostra insuficiente", sem conclusão |
| Aceite | redução ≥ 30 % na mediana geral **e** na mediana por avaliador pareado |

### I2 — Validação de pelo menos 80 % dos alertas e recomendações

| Item | Definição |
|---|---|
| Alertas | Cada alerta é avaliado pelo especialista: pertinente / parcialmente pertinente / não pertinente (justificativa obrigatória para os dois últimos) |
| Recomendações | Na tela do resultado da análise, o avaliador classifica as recomendações da mesma forma (`risk_analyses.recommendation_evaluation`, migração 0017) |
| "Validado" | apenas **pertinente** (critério estrito); "parcialmente" é mostrado à parte |
| Amostra mínima | 20 avaliações (alertas + recomendações) |
| Aceite | ≥ 80 % pertinentes no conjunto, informando também cada grupo separadamente |

Os dois indicadores aparecem em **Admin → Operação e evidências** e no pacote exportado
(`/api/admin/evidence.json`), com n, mediana, situação ("amostra insuficiente", "meta atingida",
"meta não atingida") e período.

## 2. Amostra e protocolo

- 5 a 15 avaliadores convidados (produtores, gestores ambientais, brigadistas), de pelo menos
  3 organizações; ao menos 1 especialista em manejo do fogo para avaliar alertas.
- Cada avaliador faz **a mesma tarefa nas duas formas** sobre áreas reais suas, em ordem
  alternada (metade começa pela manual) para reduzir o efeito de aprendizado.
- O especialista avalia todos os alertas por foco do período e as recomendações de ao menos
  20 análises.
- Consentimento e privacidade conforme `18_PLANO_PILOTO_OPERACAO.md` §2.

## 3. Cronograma (dias da Prova de Valor)

| Etapa | Dias | Entregas | Situação |
|---|---|---|---|
| 1. Diagnóstico, linha de base e arquitetura | 1–10 | diagnóstico (`21`), arquitetura (`02`), instrumentação da linha de base | **concluída no código** (falta medir com avaliadores) |
| 2. Dados, motor de risco, mapas e alertas | 8–35 | pipelines INPE/Sisfogo/Open-Meteo/IBGE, PostGIS, motor 1.1.0, alertas e notificações | **concluída no código e testada** (`23`, `16`) |
| 3. Integração, testes, usabilidade e correções | 30–48 | testes de ponta a ponta, segurança, carga, resiliência; SUS | **concluída em ambiente local**; SUS aguarda usuários |
| 4. Piloto controlado e validação | 47–57 | I1 e I2 medidos com avaliadores reais | **bloqueada**: precisa da VPS, de DNS e da sua autorização |
| 5. Consolidação das evidências | 56–60 | exportação, relatório final, dossiê TRL | instrumentos prontos; depende da etapa 4 |

## 4. O que não pode ser afirmado agora

- Não houve piloto: **I1 e I2 não foram medidos**, e nenhuma meta é declarada como atingida.
- A validação retrospectiva (`23`) mede a relação do índice com focos posteriores; não substitui I2.
