# Fixtures de teste

- `inpe_focos_diario_amostra.csv` — 12 linhas reais copiadas de
  `focos_diario_br_20261115.csv` (INPE — Programa Queimadas, dados públicos,
  https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/),
  escolhidas para cobrir valores `-999` e FRP vazio, seguidas de **4 linhas
  sintéticas** (sem id, coordenada inválida, data em formato errado e id
  repetido) usadas apenas para testar rejeições. Não usar como dado real.
