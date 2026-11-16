# 08 — Plano de validação da Prova de Valor (DB-IA)

> **Nenhum resultado existe ainda.** Os valores abaixo são **metas propostas** na documentação TRL 4 do projeto, não resultados alcançados.

## Metas propostas

| Meta | Definição operacional | Situação |
|---|---|---|
| Redução ≥ 30 % no tempo de análise | (tempo médio na linha de base − tempo médio com a plataforma) / tempo na linha de base | Não medido |
| ≥ 80 % de validação dos alertas e recomendações | alertas avaliados como pertinentes pelos especialistas / alertas avaliados | Não medido |

## 1. Área piloto

Registrar antes do início: identificação, município/UF, área (ha), limite GeoJSON, atividade, vegetação predominante, responsáveis, período, termo de autorização para uso dos dados, e histórico disponível (fonte, período, licença). Cadastrar na plataforma como organização própria; não misturar com dados de demonstração.

## 2. Linha de base (antes da plataforma)

- Processo atual de avaliação de risco: quem faz, com quais fontes, quanto tempo leva por área (cronometrar ≥ 10 avaliações).
- Ocorrências do período anterior equivalente (para comparação de antecedência).
- Registrar em planilha assinada pelos responsáveis.

## 3. Coleta durante o piloto

Fonte primária: a própria plataforma — cada análise grava data/hora, fontes, procedência e versão do motor; cada alerta grava o ciclo de vida; a auditoria grava quem fez o quê.

| Indicador | Como medir |
|---|---|
| Tempo de análise | Cronometrar avaliações com a plataforma, mesmo protocolo da linha de base |
| Cobertura territorial | ha com ≥ 1 análise no período / ha da área piloto |
| Avaliação dos alertas | Especialista classifica cada alerta: pertinente / parcialmente / não pertinente, com justificativa (usar a observação do status) |
| Falsos positivos / negativos | Alerta sem evento relevante na janela definida; evento sem alerta prévio |
| Antecedência útil | Tempo entre o alerta e a ocorrência, **somente** quando houver ocorrência confirmada independente |
| Avaliação dos usuários | Questionário SUS + perguntas abertas, ao fim do piloto |
| Disponibilidade | Falhas registradas no `/api/health` (monitor externo) |

Definir **antes** do piloto: janela temporal para considerar um alerta "confirmado", e quem confirma ocorrências (fonte independente da plataforma).

## 4. Calibração (Fase 4)

Somente com dados reais rotulados e representativos:
1. Separação temporal treino/teste (sem vazamento entre períodos e entre áreas vizinhas).
2. Métricas por classe, matriz de confusão, custo de falsos negativos.
3. Comparação com o motor de regras na mesma base de teste.
4. Registro da versão, do dataset e das limitações; ativar só se superar o motor de regras e com aprovação dos especialistas.

## 5. Relatório de evidências

Comparação linha de base × piloto por indicador, com: método, período, amostra, resultado, incerteza, desvios do protocolo e exportações CSV da plataforma como anexo. Resultados abaixo das metas devem ser relatados como tal.
