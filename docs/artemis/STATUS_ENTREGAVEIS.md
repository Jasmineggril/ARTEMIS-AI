# Status dos entregáveis — ARTEMIS AI

Legenda: **Implementado e testado** · **Implementado** (sem teste automatizado dedicado) · **Parcial** · **Pendente** · **Bloqueado**

Última atualização: 15/11/2026.

| # | Entregável | Status | Evidência / observação |
|---|---|---|---|
| 1 | Diagnóstico do repositório | Implementado | `00_DIAGNOSTICO.md` |
| 2 | Requisitos funcionais e não funcionais | Implementado | `01_REQUISITOS.md` |
| 3 | Arquitetura atualizada | Implementado | `02_ARQUITETURA.md` |
| 4 | Identidade visual | Parcial | Marca, nome, paleta e telas de autenticação. Landing page ainda com textos do CERES AI; modo escuro não revisado tela a tela. |
| 5 | Frontend funcional e responsivo | Parcial | Login, cadastro, recuperação de senha, dashboard, áreas, análise, alertas, mapa, organização e privacidade usam a API real. Relatórios e Inteligência Operacional também usam a API real. Testado em 1366 px e iPhone 13. |
| 6 | Backend integrado | Implementado e testado | 27 testes de integração com PostgreSQL real |
| 7 | Serviço de análise de risco | Implementado e testado | 109 pytest; caminho Node→Python testado com o serviço no ar e com fallback |
| 8 | Banco de dados e migrações | Implementado e testado | `0002_artemis_core.sql`, idempotente, aplicada 2× sem erro |
| 9 | Mapas e gráficos | Parcial | Áreas, polígonos e ocorrências com filtros. Pendente: agrupamento de pontos, desenho de polígono no mapa, busca por endereço, camada de focos de calor. |
| 10 | Módulo de alertas | Implementado e testado | Ciclo de vida, histórico, deduplicação. **Notificação por e-mail pendente.** |
| 11 | Importação de dados | Implementado e testado | Revalidação no servidor, motivos de rejeição por lote, isolamento por organização |
| 12 | Relatórios | Parcial | Relatório por área e período (resumo, distribuição, histórico, alertas e medidas, fontes, qualidade, motor/versão, limitações), impressão/PDF pelo navegador e CSV. Pendentes: PDF gerado no servidor, mapa dentro do relatório, módulo PoV. |
| 13 | Testes automatizados | Implementado | 34 + 10 TS legados, 14 unitários, 29 integração, 109 pytest, 11 E2E, 11 telas axe |
| 14 | Documentação das APIs | Implementado | `03_API.md` |
| 15 | Docker Compose dev e produção | Parcial | Arquivos validados com `docker compose config`. **Build das imagens não verificado** neste ambiente (Docker Hub respondeu HTTP 429). |
| 16 | Implantação na Hostinger | Implementado (documento) | `04_IMPLANTACAO_HOSTINGER.md`. Não executado: requer VPS e autorização. |
| 17 | Backup e recuperação | Implementado e testado | Ciclo backup → restauração executado com contagens idênticas; recusa banco não vazio; falha com senha errada |
| 18 | Manual do usuário e do administrador | Implementado | `06_MANUAL.md` |
| 19 | Limitações e pendências | Implementado | `07_LIMITACOES_PENDENCIAS.md` |
| 20 | Plano de validação da Prova de Valor | Implementado (plano) | `08_PLANO_PROVA_DE_VALOR.md`. Nenhum resultado da PoV existe ainda. |

## Critérios de aceitação da primeira versão (seção 16 do prompt mestre)

| Critério | Situação | Evidência |
|---|---|---|
| Usuário autorizado acessa a plataforma | Atendido | integração 3–6, E2E `signup` |
| Organização cadastra área | Atendido | integração 11, E2E `create area` |
| Análise executada e explicada | Atendido | integração 14, E2E `analyze area` |
| Resultado armazenado e recuperado | Atendido | integração 14 (histórico + `GET /api/analyses/:id`) |
| Mapa apresenta áreas e ocorrências | Atendido | E2E `map renders area` |
| Filtros funcionam | Atendido (API) | integração 18; filtros do mapa sem teste E2E dedicado |
| Alertas gerenciados | Atendido | integração 15–17, E2E `alert lifecycle` |
| Dados históricos importados com validação | Atendido | integração 18–19 |
| Relatórios exportados | Parcial | Relatório por período e CSV testados (integração); PDF pelo navegador |
| Permissões impedem acesso indevido | Atendido | integração 20–21 |
| Funciona em celular e desktop | Atendido nas telas testadas | E2E `mobile layout` (4 rotas, sem rolagem horizontal) |
| Testes críticos executados e aprovados | Atendido | ver tabela acima |
| Implantação e restauração documentadas | Parcial | restauração testada; implantação documentada, não executada |

**A plataforma não está pronta para produção.** Ver `07_LIMITACOES_PENDENCIAS.md`.
