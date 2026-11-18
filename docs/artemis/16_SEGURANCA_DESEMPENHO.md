# 16 — Segurança e desempenho (homologação, 2026-11-17)

Os resultados abaixo vêm da execução automatizada contra um **build de produção local**
(`NODE_ENV=production`, PostgreSQL 16, motor Python), com contas descartáveis.
Nada foi executado contra produção. As evidências brutas estão em
`docs/artemis/evidencias/2026-11-17/`.

## 1. Verificações de segurança — 28/28 aprovadas

Script: `tests/security/security-check.cjs` · relatório: `seguranca-verificacoes.json`.

| Área | O que foi verificado |
|---|---|
| Cabeçalhos | CSP sem `unsafe-eval`, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, HSTS, sem `X-Powered-By` |
| Sessão | cookie `HttpOnly`, `SameSite=Lax`, `Secure` atrás de HTTPS |
| Autenticação | senha fraca recusada; login e recuperação de senha não revelam se o e-mail existe; limite de tentativas (429) |
| Autorização | 13 rotas protegidas exigem login; dono de organização não acessa o painel da plataforma nem a sincronização manual |
| Isolamento (IDOR) | outra organização não lê, altera, analisa, exporta nem apaga a área (7 operações) |
| CSRF | POST com `Origin` de outro site é recusado (403) |
| Injeção | sondagens de SQL injection retornam 400 ou resultado vazio, sem erro do banco e sem atraso (`pg_sleep`) |
| Robustez | corpo > 15 MB → 413; travessia de diretório não expõe arquivos; JSON malformado → 400 sem pilha |
| XSS armazenado | HTML no nome da área é exibido como texto e não executa (verificado no navegador) |

## 2. Dependências

| Ecossistema | Antes | Depois | Observação |
|---|---|---|---|
| npm (produção) | 11 | 3 | crítica corrigida (drizzle-orm 0.45.4, nodemailer 10.6.0, override `qs` 6.16.2) |
| pip (motor) | 7 | 0 | fastapi 0.163.1, starlette 1.10.0 |

### Riscos residuais (aceitos com mitigação, aguardando decisão)

| Item | Risco | Mitigação atual | Ação futura |
|---|---|---|---|
| `xlsx` (sem correção publicada) | prototype pollution / ReDoS ao **ler** planilhas | usado só no navegador do próprio usuário para importar o arquivo dele; o servidor não processa xlsx | trocar por `exceljs` ou exigir CSV |
| `zod` 3 / `zod-validation-error` | avisos que só se resolvem na versão major 4 | entradas validadas com esquemas fechados; limite de corpo | migrar para zod 4 + drizzle-zod 0.8 em PR separado com testes |

## 3. Carga — `carga.json`

Ambiente: 4 vCPU Xeon 2.1 GHz, 16 GB, autocannon 7.15.0, limitador desligado **somente** nesta instância de teste.

| Rota | Conexões | req/s | p50 | p99 | Erros |
|---|---|---|---|---|---|
| `/api/health` | 10 | 803 | — | 26 ms | 0 |
| página inicial | 10 | 1 282 | — | 26 ms | 0 |
| `/api/areas` | 10 | 844 | 11 ms | 23 ms | 0 |
| `/api/areas/:id/surroundings` | 10 | 482 | 19 ms | 37 ms | 0 |
| resumo Sisfogo público | 10 | 426 | — | 42 ms | 0 |
| focos INPE (AM) | 10 | 263 | — | 67 ms | 0 |
| `POST /api/areas/:id/analyses` (motor Python) | 5 | 217 | 21 ms | 46 ms | 0 |

**Leitura honesta:** os números mostram folga para um piloto (dezenas de usuários),
mas foram medidos numa máquina maior que a VPS prevista e sem latência de rede.
O desempenho real será medido pela telemetria (`ops_request_metrics`) no ambiente operacional.

## 4. Volume real e resiliência (2026-11-18)

Banco com **2 650 395 focos reais do INPE** (01/08–18/11/2026; 2,4 GB), PostGIS 3.4.2.
Evidências: `evidencias/2026-11-18/carga-volume-real.json`, `resiliencia.json`.

**Ingestão.** Mês de agosto (651 243 focos) em 109 s; setembro (777 214) em 130 s; outubro
(931 795) em 150 s — cerca de 6 mil registros/s, cada arquivo numa transação. Reprocessar
outubro inteiro: 0 inseridos, 0 atualizados, 931 795 inalterados (idempotente).

**Consulta espacial** (área de 4 km² em Alenquer/PA, raio de 25 km, 90 dias):

| Modo | Plano | Tempo |
|---|---|---|
| PostGIS | Bitmap Index Scan em `satellite_hotspots_geom_gix` (GiST) | 42,9 ms |
| Reserva sem PostGIS | Bitmap Index Scan em `satellite_hotspots_lat_lng_idx` | 16,3 ms (+ distância exata na aplicação) |

**Carga HTTP** (build de produção, autocannon, 15 s, 10 conexões; área no ponto com mais focos do país):

| Rota | req/s | p50 | p99 | Erros |
|---|---|---|---|---|
| `/api/health` | 894 | 10 ms | 22 ms | 0 |
| `/api/areas` | 1 041 | 9 ms | 17 ms | 0 |
| `/api/areas/:id` (com conferência do município no IBGE) | 889 | 10 ms | 22 ms | 0 |
| entorno, 7 dias (1 752 focos a até 10 km) | 73 | 136 ms | 206 ms | 0 |
| entorno, 30 dias (**6 030 focos** a até 10 km) | 25 | 387 ms | 456 ms | 0 |
| grade nacional de focos | 174 | 56 ms | 93 ms | 0 |
| resumo Sisfogo | 526 | 18 ms | 33 ms | 0 |
| `POST` análise (5 conexões) | 130 | 37 ms | 58 ms | 0 |

O entorno de 30 dias no pior ponto do país é a consulta mais pesada (serializa milhares de
detecções); fica abaixo de 0,5 s no p99.

**Resiliência — 11/11** (`tests/resilience/resilience-check.cjs`):

| Cenário | Resultado |
|---|---|
| Motor Python fora do ar | análise feita pelo motor TypeScript, registrada como tal, com a mesma pontuação (44 × 44); volta ao Python em 1 s após reiniciar |
| Banco fora do ar | `/api/health` → 503 `database: down`; requisições → 500 controlado; **o processo não cai**; recupera-se sozinho quando o banco volta, com a sessão preservada |
| Reinício da aplicação | volta em 1 s; login e análises preservados |

Os dois primeiros problemas de banco foram **encontrados por este teste e corrigidos**: antes, o
processo morria quando o PostgreSQL encerrava as conexões, e o health check respondia 500.

## 5. O que estes testes **não** cobrem

- teste de intrusão por terceiros; varredura do servidor/VPS (portas, SSH, firewall);
- comportamento sob latência real das fontes externas (INPE, Sisfogo, Open-Meteo);
- carga prolongada (horas) e esgotamento de disco/conexões;
- restauração de backup na VPS (testada apenas localmente — ver `05_BACKUP_RECUPERACAO.md`).
