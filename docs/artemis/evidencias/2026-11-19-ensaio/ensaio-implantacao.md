# Ensaio da implantação da homologação (2026-11-19)

Ambiente: contêiner de desenvolvimento com Docker 29.9.2; mesmas imagens e o mesmo `docker-compose.yml` +
`docker-compose.homolog.yml` da VPS (projeto `artemis-ensaio`, domínio `artemis.localhost` com certificado
interno do Caddy). Para o build alcançar npm/PyPI, a cópia de ensaio recebeu o proxy e o certificado
deste ambiente — o repositório não foi alterado para isso; na VPS o build usa a internet diretamente.

| Verificação | Resultado |
|---|---|
| Build da imagem do motor (Python) | ok, 55 s |
| Build da imagem da API (npm ci + frontend + CLIs) | ok, 45 s |
| `up -d` (db PostGIS, migrate, risk-engine, api, caddy) | ok; api *healthy* |
| Migrações | `Applied 19 migration(s)` (0000–0018), PostGIS ativo |
| HTTP → HTTPS | 308 |
| Sem senha do site | 401 |
| Com senha: `/api/health` | `{"status":"ok","database":"ok","riskEngine":"ok"}` |
| Cabeçalhos | HSTS, CSP, X-Frame-Options DENY, X-Robots-Tag noindex |
| Rota INMET (`/api/weather-stations`) | 200 |
| Criação da administradora (`create-admin`) | link de uso único gerado (72 h) |
| Serviço `inmet-sync` | executa; sem internet no ensaio → falha registrada após 4 tentativas, nada gravado, demais serviços intactos |
| Volume de arquivos brutos do INMET | gravável pelo usuário `node` |
| Backup criptografado (`backup.sh`) | ok, 32 KB, sha256 conferido |
| Restauração em banco novo (`restore.sh`) | ok, contagens conferidas (19 migrações, 1 usuário, 1 organização) |
| Memória da carga anual do INMET (634 arquivos, 3,2 M linhas) | pico de 304 MB (limites: API 1 GB, `inmet-sync` 1,5 GB) |

Problemas encontrados e corrigidos antes de passar ao responsável pela VPS:
1. Os comandos de limites do IBGE e do INMET não estavam no pacote de produção → incluídos no build.
2. Não havia serviço para a carga do INMET nem volume para os arquivos brutos → `inmet-sync` + volume `inmet_raw`.
3. `docker compose run` do script recriava toda a stack → `--no-deps` nos comandos avulsos.
4. O script não carregava limites do IBGE nem INMET → incluídos no passo 5.

Não verificado no ensaio: certificado real do Let's Encrypt e carga das fontes externas dentro dos contêineres.
