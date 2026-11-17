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

## 4. O que estes testes **não** cobrem

- teste de intrusão por terceiros; varredura do servidor/VPS (portas, SSH, firewall);
- comportamento sob latência real das fontes externas (INPE, Sisfogo, Open-Meteo);
- carga prolongada (horas) e esgotamento de disco/conexões;
- restauração de backup na VPS (testada apenas localmente — ver `05_BACKUP_RECUPERACAO.md`).
