# CONTEXTO.md — Novo Plano Construções

Gerado em 14/09/2026. Cobre o trabalho feito na aba Documentos (recursos de IA)
até este ponto.

## Objetivo do projeto

App de gestão de construção civil (Novo Plano Construções), single-file
HTML/CSS/JS, backend Supabase (Postgres/RLS/Auth/Storage/Edge Functions).
Trabalho recente concentrado na seção **Documentos**: dois recursos de IA —
comparação/verificação cruzada entre documentos e geração automática de
documentos padrão da empresa a partir de modelos reais.

## Decisões tomadas

- **Arquitetura**: tudo em `index.html`, sem build step; todo JS numa única
  IIFE `(function(){ "use strict"; ... })()`.
- **Backend**: Supabase sem CLI instalada localmente — deploy de Edge
  Function é sempre manual (código colado no editor do Supabase Dashboard).
- **IA**: Anthropic Messages API (`claude-sonnet-5`), chamada só de dentro
  das Edge Functions, nunca do client direto. Secret `ANTHROPIC_API_KEY`
  compartilhado pelas duas functions.
- **Segurança**: nunca repetir/ecoar chaves de API que aparecerem coladas no
  chat — instruir revogar e gerar nova.
- **Análise da IA (comparação de documentos)**: rejeitada abordagem
  determinística com schema fixo de campos (`comparison_fields`) — decisão
  final é a IA ler os documentos inteiros e decidir sozinha o que é
  comparável, sem lista pré-definida, ignorando diferenças cosméticas
  (unidade de medida, pontuação, maiúsculas).
- **Comparação N-para-1**: cada documento "a conferir" é comparado contra
  **todos** os documentos de referência numa única chamada — nunca
  pareamento por índice.
- **Taxonomia de status**: `bate` / `diverge` / `so_a` / `so_b`. Regra
  importante: valor diferente no mesmo tipo de campo é **sempre** `diverge`
  — `so_a`/`so_b` é reservado só pra quando não existe nada comparável do
  outro lado.
- **Grifo automático no PDF**: foi construído e corrigido, mas depois
  **removido a pedido do usuário** — não reintroduzir sem pedido explícito.
- **Criação de documento**: lista fixa de 4 tipos (não texto livre); modelos
  reais da empresa embutidos na Edge Function só como referência de
  ESTRUTURA/formatação — nunca como fonte de dados concretos (nome de
  empresa, CNPJ etc. sempre vêm dos documentos-fonte anexados).
- **Saída da criação de documento**: mostrar na tela + copiar/baixar
  (`.txt` e `.pdf` via jsPDF, fonte Helvetica).
- Dois arquivos fixos por empresa (Manual do Morador, Garantia MCMV) ficam
  sempre disponíveis pra download direto na aba, mesmos em todo projeto.

## O que já foi feito

Arquivos alterados/criados:
- `index.html` — aba "Análise da IA" e nova aba "Criação de documento"
  dentro de Documentos, além de vários bugfixes.
- `supabase/functions/analyze-document/index.ts` — reescrito várias vezes.
- `supabase/functions/generate-document/index.ts` — novo, ainda não
  commitado.
- `supabase/schema.sql` — tem tabelas dormentes de tentativas anteriores
  (`comparison_fields`, `reference_values`) que não são mais usadas pelo
  client, mas ficaram no schema.

Funcionalidades:
- **Análise da IA**: passou por 5 arquiteturas até convergir na versão
  aberta (uma chamada, sem schema fixo). Comparação N-para-1 implementada e
  corrigida (regressão de precisão no prompt causava `so_a`/`so_b` em vez
  de `diverge` — corrigida instruindo a IA a achar o campo correspondente
  por conceito, não pela redação exata).
- **Grifo no PDF**: construído (canvas + pdf.js), teve bug de alinhamento
  de posição corrigido, depois removido por completo a pedido do usuário.
- **Criação de documento**: nova aba com 4 modelos reais (Termo de
  Vistoria, Certificado de Entrega, Declaração MCMV, Requerimento de
  Averbação), geração via IA a partir de documentos-fonte anexados,
  correção de um bug onde o CNPJ/empresa do modelo de exemplo estava sendo
  tratado como constante fixa (deveria vir sempre dos documentos-fonte),
  exportação em `.txt`/`.pdf`/copiar, e card fixo com download do Manual do
  Morador e Garantia MCMV.
- Corrigidos 4 padrões de bug recorrentes da arquitetura single-file:
  escopo de função em `onclick` inline, CSS de `display` vencendo
  `[hidden]`, overflow em flex/grid sem `min-width:0`, e erro real da Edge
  Function escondido pelo `supabase-js` (corrigido com helper
  `extractErrorMessage`).

## Pendências / próximos passos

1. **Confirmar deploy do `generate-document`** no Supabase Dashboard com a
   última correção (empresa extraída dos documentos-fonte, não fixa) — o
   código já foi copiado pra área de transferência pro usuário colar.
2. **Subir os 2 PDFs padrão no Storage**: bucket `documentos`, caminhos
   `recursos/manual-do-morador.pdf` e `recursos/garantia-mcmv.pdf`. Os
   botões da aba "Criação de documento" já apontam pra esses caminhos
   fixos — só falta o upload manual via Supabase Dashboard.
3. **`index.html` e `supabase/` ainda não commitados no git** — `git
   status` mostra `index.html` modificado e `supabase/` inteiro como
   untracked. Não commitar sem confirmar com o usuário (só commitar quando
   explicitamente pedido).

## Detalhes importantes para não esquecer

- **Sem CLI do Supabase instalada** — todo código de Edge Function precisa
  ser entregue via `pbcopy` (área de transferência) pro usuário colar
  manualmente no editor do Supabase Dashboard e publicar.
- **Nunca reintroduzir** schema fixo de campos de comparação
  (`comparison_fields`) nem a feature de grifo no PDF sem pedido explícito
  — ambos foram tentados e descartados deliberadamente.
- **Nunca repetir/logar segredos** (chaves de API) que aparecerem no chat —
  instruir o usuário a revogar e gerar uma nova.
- **Migrations SQL sempre auto-contidas e idempotentes**
  (`create table if not exists ...`) — uma migration incremental já causou
  erro `relation "public.comparison_fields" does not exist` por assumir que
  uma tabela base já existia.
- **Sem ferramenta de automação de browser** — todo teste funcional é feito
  pelo usuário via captura de tela; sempre pedir pra recarregar com
  `Cmd+Shift+R` depois de mudanças no `index.html`.
- Depois de qualquer edição em `index.html`, rodar verificação estrutural
  (IDs duplicados, balanceamento de `{}/()/[]` no bloco `<script>`,
  cruzamento de funções chamadas em `onclick` inline vs. `window.fn =`)
  antes de considerar a mudança pronta.
