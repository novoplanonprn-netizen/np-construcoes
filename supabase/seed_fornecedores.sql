-- ============================================================================
-- Cadastro inicial de fornecedores — Novo Plano Construções
-- Rode no SQL Editor do Supabase (depois de rodar schema.sql pelo menos uma vez).
-- Seguro rodar de novo: nomes repetidos são ignorados (on conflict do nothing).
-- ============================================================================

insert into public.fornecedores (nome) values
  ('PUTU - TIJOLO'),
  ('FABRÍCIO - AREIA'),
  ('SELTON BRITA'),
  ('NORTE FERRO'),
  ('ERY JHONSON - AREIA'),
  ('ROGERIO - VIDRO'),
  ('VANDERLUCIO - MARMORE'),
  ('ANDRÉA MÃE RAINHA'),
  ('THIAGO POTIGUAR CIMENTOS'),
  ('NP LOCAÇÕES'),
  ('BRUNA - AÇO E CIA'),
  ('EDSON MÁQUINAS'),
  ('EDNELSON - VALE DO PARÁ'),
  ('CARLOS - BELÉM MADEIRA'),
  ('RODRIGO - CIMENTO'),
  ('ATACADO DO LOGISTA'),
  ('MERCADO LIVRE'),
  ('CARAJAS'),
  ('DONA SOCORRO'),
  ('PIRRITA METAIS'),
  ('MACIEL MATERIAL'),
  ('SACOLA - ATERRO'),
  ('CHICO- ATERRO'),
  ('MARINHO - HIDRO E ELETRICA'),
  ('COMECIAL BOM JESUS'),
  ('WALTECIO - VEEME'),
  ('CASA DAS COLUNAS'),
  ('MONTANA'),
  ('COMERCIAL ESPERANÇA'),
  ('FRANKLIN - MADEIRA - TELHA'),
  ('SOLAR GESSO'),
  ('BRUNO PORTÃO'),
  ('PAULA DRYEDA'),
  ('FORTINIL - SERGIO'),
  ('CONSTRUMAD'),
  ('OUTROS'),
  ('LUCIANO - PRE MOLDADO')
on conflict (nome) do nothing
returning nome;
