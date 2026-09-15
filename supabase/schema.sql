-- ============================================================================
-- Novo Plano Construções — schema inicial (Supabase / Postgres)
--
-- Como rodar:
--   1. Abra o painel do seu projeto em supabase.com
--   2. Vá em "SQL Editor" → "New query"
--   3. Cole este arquivo inteiro e clique em "Run"
--
-- Depois de rodar, transforme sua própria conta em administrador
-- (troque o e-mail abaixo pelo que você usou no cadastro):
--   update public.profiles set role = 'admin' where email = 'voce@suaempresa.com.br';
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- PERMISSÕES DE ESQUEMA — sem isso o Postgres barra o acesso antes mesmo de
-- avaliar as regras de RLS abaixo, e a API devolve 403 em qualquer consulta.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
-- as linhas de "default privileges" acima só valem para tabelas criadas depois delas;
-- a linha abaixo (rodada no fim do arquivo) cobre as tabelas que este mesmo script já criou.

-- ---------------------------------------------------------------------------
-- PERFIS — espelha auth.users com papel (admin/member) e status de acesso
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'member' check (role in ('admin','member')),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now()
);

-- cria o perfil automaticamente a cada novo cadastro em auth.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- impede que um usuário comum promova a si mesmo a admin ou se reative
-- (somente um admin pode alterar role/status de qualquer perfil pela API/site).
-- auth.uid() só existe numa requisição autenticada via API; quando é nulo (SQL Editor,
-- migrações, acesso direto ao banco) a alteração é sempre permitida — do contrário
-- um UPDATE manual feito por você mesmo no SQL Editor seria revertido silenciosamente,
-- porque ali não existe "usuário logado" e a checagem de admin sempre daria falso.
create or replace function public.guard_profile_privilege()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.status := old.status;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- FUNÇÕES DE PERMISSÃO (security definer evita recursão de RLS)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  );
$$;

drop trigger if exists profiles_guard_privilege on public.profiles;
create trigger profiles_guard_privilege
  before update on public.profiles
  for each row execute procedure public.guard_profile_privilege();

-- ---------------------------------------------------------------------------
-- PROJETOS (substitui o antigo modelo por "lote")
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  started_at date default current_date,
  status text not null default 'em_andamento' check (status in ('em_andamento','concluido','vendido','pausado')),
  sale_price numeric(14,2) not null default 0,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- FORNECEDORES — cadastro compartilhado pela empresa
-- ---------------------------------------------------------------------------
create table if not exists public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  contato text,
  created_at timestamptz not null default now()
);
create unique index if not exists fornecedores_nome_idx on public.fornecedores (nome);

-- ---------------------------------------------------------------------------
-- COMPRAS DE MATERIAL — por projeto
-- ---------------------------------------------------------------------------
create table if not exists public.project_materials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  descricao text not null,
  unidade text,
  quantidade numeric(14,2),
  fornecedor text,
  categoria text,
  valor numeric(14,2) not null default 0,
  status_pagamento text not null default 'Pendente' check (status_pagamento in ('Pago','Pendente')),
  status_entrega text not null default 'Falta entregar' check (status_entrega in ('Entregue','Falta entregar')),
  data_pedido date default current_date,
  data_prevista_pagamento date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.project_materials add column if not exists data_prevista_pagamento date;
alter table public.project_materials add column if not exists unidade text;
alter table public.project_materials add column if not exists quantidade numeric(14,2);

-- ---------------------------------------------------------------------------
-- OUTROS CUSTOS — lote (terreno), terceiros e documentação, por projeto
-- ---------------------------------------------------------------------------
create table if not exists public.project_other_costs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  tipo text not null check (tipo in ('lote','terceiros','documentacao')),
  descricao text not null,
  valor numeric(14,2) not null default 0,
  data date default current_date,
  status_pagamento text not null default 'Pendente' check (status_pagamento in ('Pago','Pendente')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- CASAS — um projeto pode ter uma ou várias casas; cada casa tem seu próprio
-- valor de venda. O material continua rateado por projeto (não por casa).
-- ---------------------------------------------------------------------------
create table if not exists public.casas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  nome text not null,
  sale_price numeric(14,2) not null default 0,
  status text not null default 'em_construcao' check (status in ('em_construcao','engenharia','habite_se','averbacao','conformidade','alvara','registro','vendida')),
  data_venda_prevista date,
  data_venda date,
  created_at timestamptz not null default now()
);
alter table public.casas add column if not exists status text not null default 'em_construcao';
alter table public.casas drop constraint if exists casas_status_check;
alter table public.casas add constraint casas_status_check check (status in ('em_construcao','engenharia','habite_se','averbacao','conformidade','alvara','registro','vendida'));
alter table public.casas add column if not exists data_venda_prevista date;
alter table public.casas add column if not exists data_venda date;

-- ---------------------------------------------------------------------------
-- MÃO DE OBRA — por casa (não mais por projeto)
-- ---------------------------------------------------------------------------
create table if not exists public.project_labor (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  casa_id uuid references public.casas(id) on delete cascade,
  equipe text not null,
  parcela_label text not null,
  valor numeric(14,2) not null default 0,
  status text not null default 'Pendente' check (status in ('Pago','Pendente')),
  vencimento date,
  created_at timestamptz not null default now()
);
alter table public.project_labor add column if not exists casa_id uuid references public.casas(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- PASTAS DE DOCUMENTOS — por projeto, com sub-pastas e ordenação manual
-- ---------------------------------------------------------------------------
create table if not exists public.document_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  parent_id uuid references public.document_folders(id) on delete cascade,
  name text not null,
  color text,
  order_index integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.document_folders add column if not exists color text;

-- ---------------------------------------------------------------------------
-- DOCUMENTOS — com campo de análise
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  folder_id uuid references public.document_folders(id) on delete cascade,
  name text not null,
  file_path text,
  file_type text,
  size_bytes bigint,
  order_index integer not null default 0,
  analysis_status text not null default 'pendente' check (analysis_status in ('pendente','em_analise','aprovado','reprovado')),
  analysis_notes text,
  analyzed_by uuid references public.profiles(id),
  analyzed_at timestamptz,
  document_type text,
  verification_status text not null default 'nao_verificado',
  verification_notes text,
  field_values jsonb,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.documents add column if not exists document_type text;
alter table public.documents add column if not exists verification_status text not null default 'nao_verificado';
alter table public.documents add column if not exists verification_notes text;
alter table public.documents add column if not exists field_values jsonb;
alter table public.documents add column if not exists extracted_fields jsonb;
alter table public.documents drop column if exists verification_expected;
alter table public.documents drop column if exists ai_analysis;

-- ---------------------------------------------------------------------------
-- CAMPOS DE COMPARAÇÃO — lista compartilhada de campos-chave (Matrícula, Quadra,
-- Lote etc.) usados para conferir se os dados batem entre documentos de um projeto.
-- ---------------------------------------------------------------------------
create table if not exists public.comparison_fields (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  order_index integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.comparison_fields add column if not exists category text;

-- taxonomia trocada por uma versão mais enxuta (38 campos / 10 categorias) — substitui a anterior
delete from public.comparison_fields;

insert into public.comparison_fields (name, category, order_index) values
  ('Lote', 'Identificação do imóvel/lote', 0),
  ('Quadra', 'Identificação do imóvel/lote', 1),
  ('Bairro', 'Identificação do imóvel/lote', 2),
  ('Rua/Endereço', 'Identificação do imóvel/lote', 3),
  ('Número', 'Identificação do imóvel/lote', 4),
  ('Matrícula/Registro', 'Identificação do imóvel/lote', 5),
  ('Cidade', 'Identificação do imóvel/lote', 6),
  ('CEP', 'Identificação do imóvel/lote', 7),

  ('Nome da empresa/Razão social', 'Partes envolvidas', 8),
  ('CNPJ', 'Partes envolvidas', 9),
  ('Responsável legal/sócio', 'Partes envolvidas', 10),

  ('Área construída (m²)', 'Construção/edificação', 11),
  ('Área total (m²)', 'Construção/edificação', 12),
  ('Número de cômodos', 'Construção/edificação', 13),
  ('Quartos', 'Construção/edificação', 14),
  ('Banheiros', 'Construção/edificação', 15),
  ('Varanda', 'Construção/edificação', 16),
  ('Metragem por cômodo (m²)', 'Construção/edificação', 17),
  ('Número de casas/unidades', 'Construção/edificação', 18),

  ('Número do Habite-se', 'Habite-se', 19),
  ('Data de emissão do Habite-se', 'Habite-se', 20),
  ('Área aprovada (m²)', 'Habite-se', 21),

  ('Número de inscrição municipal', 'Características do imóvel (IPTU)', 22),
  ('Área do terreno (m²)', 'Características do imóvel (IPTU)', 23),
  ('Uso do imóvel', 'Características do imóvel (IPTU)', 24),

  ('Número/protocolo da averbação', 'Averbação', 25),
  ('Data da averbação', 'Averbação', 26),
  ('Área averbada (m²)', 'Averbação', 27),

  ('Data de emissão do documento', 'Datas', 28),
  ('Data de validade/protocolo', 'Datas', 29),

  ('ART/RRT de projeto', 'Responsabilidade técnica (RRT)', 30),
  ('ART/RRT de execução', 'Responsabilidade técnica (RRT)', 31),
  ('Nome do responsável técnico', 'Responsabilidade técnica (RRT)', 32),
  ('CREA/CAU', 'Responsabilidade técnica (RRT)', 33),

  ('Contrato social (nº)', 'Dados fiscais/societários', 34),
  ('Capital social', 'Dados fiscais/societários', 35),

  ('Número de protocolo/CND', 'Certidões e protocolos', 36),
  ('Código de emissão', 'Certidões e protocolos', 37)
on conflict (name) do update set category = excluded.category, order_index = excluded.order_index;

-- ---------------------------------------------------------------------------
-- VALORES DE REFERÊNCIA — dados fixos por projeto (CNPJ oficial, quadra, lote,
-- área total etc.) usados como "gabarito" pra comparar qualquer documento contra
-- eles, sem precisar de um segundo documento.
-- ---------------------------------------------------------------------------
create table if not exists public.reference_values (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  field_name text not null,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, field_name)
);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_materials enable row level security;
alter table public.project_labor enable row level security;
alter table public.casas enable row level security;
alter table public.project_other_costs enable row level security;
alter table public.document_folders enable row level security;
alter table public.documents enable row level security;
alter table public.fornecedores enable row level security;
alter table public.comparison_fields enable row level security;
alter table public.reference_values enable row level security;

-- profiles: qualquer usuário ativo enxerga a lista da equipe (para atribuição de
-- "criado por" / "analisado por"); só o próprio dono da linha ou um admin edita.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (public.is_active_user() or id = auth.uid());

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin" on public.profiles
  for delete using (public.is_admin());

-- projetos / materiais / mão de obra / pastas / documentos:
-- qualquer usuário ativo lê e escreve (ferramenta interna da construtora);
-- só admin apaga um projeto inteiro.
drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects for select using (public.is_active_user());
drop policy if exists "projects_insert" on public.projects;
create policy "projects_insert" on public.projects for insert with check (public.is_active_user());
drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects for update using (public.is_active_user());
drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects for delete using (public.is_admin());

drop policy if exists "materials_select" on public.project_materials;
create policy "materials_select" on public.project_materials for select using (public.is_active_user());
drop policy if exists "materials_insert" on public.project_materials;
create policy "materials_insert" on public.project_materials for insert with check (public.is_active_user());
drop policy if exists "materials_update" on public.project_materials;
create policy "materials_update" on public.project_materials for update using (public.is_active_user());
drop policy if exists "materials_delete" on public.project_materials;
create policy "materials_delete" on public.project_materials for delete using (public.is_active_user());

drop policy if exists "labor_select" on public.project_labor;
create policy "labor_select" on public.project_labor for select using (public.is_active_user());
drop policy if exists "labor_insert" on public.project_labor;
create policy "labor_insert" on public.project_labor for insert with check (public.is_active_user());
drop policy if exists "labor_update" on public.project_labor;
create policy "labor_update" on public.project_labor for update using (public.is_active_user());
drop policy if exists "labor_delete" on public.project_labor;
create policy "labor_delete" on public.project_labor for delete using (public.is_active_user());

drop policy if exists "casas_select" on public.casas;
create policy "casas_select" on public.casas for select using (public.is_active_user());
drop policy if exists "casas_insert" on public.casas;
create policy "casas_insert" on public.casas for insert with check (public.is_active_user());
drop policy if exists "casas_update" on public.casas;
create policy "casas_update" on public.casas for update using (public.is_active_user());
drop policy if exists "casas_delete" on public.casas;
create policy "casas_delete" on public.casas for delete using (public.is_active_user());

drop policy if exists "other_costs_select" on public.project_other_costs;
create policy "other_costs_select" on public.project_other_costs for select using (public.is_active_user());
drop policy if exists "other_costs_insert" on public.project_other_costs;
create policy "other_costs_insert" on public.project_other_costs for insert with check (public.is_active_user());
drop policy if exists "other_costs_update" on public.project_other_costs;
create policy "other_costs_update" on public.project_other_costs for update using (public.is_active_user());
drop policy if exists "other_costs_delete" on public.project_other_costs;
create policy "other_costs_delete" on public.project_other_costs for delete using (public.is_active_user());

drop policy if exists "folders_select" on public.document_folders;
create policy "folders_select" on public.document_folders for select using (public.is_active_user());
drop policy if exists "folders_insert" on public.document_folders;
create policy "folders_insert" on public.document_folders for insert with check (public.is_active_user());
drop policy if exists "folders_update" on public.document_folders;
create policy "folders_update" on public.document_folders for update using (public.is_active_user());
drop policy if exists "folders_delete" on public.document_folders;
create policy "folders_delete" on public.document_folders for delete using (public.is_active_user());

drop policy if exists "documents_select" on public.documents;
create policy "documents_select" on public.documents for select using (public.is_active_user());
drop policy if exists "documents_insert" on public.documents;
create policy "documents_insert" on public.documents for insert with check (public.is_active_user());
drop policy if exists "documents_update" on public.documents;
create policy "documents_update" on public.documents for update using (public.is_active_user());
drop policy if exists "documents_delete" on public.documents;
create policy "documents_delete" on public.documents for delete using (public.is_active_user());

drop policy if exists "fornecedores_select" on public.fornecedores;
create policy "fornecedores_select" on public.fornecedores for select using (public.is_active_user());
drop policy if exists "fornecedores_insert" on public.fornecedores;
create policy "fornecedores_insert" on public.fornecedores for insert with check (public.is_active_user());
drop policy if exists "fornecedores_update" on public.fornecedores;
create policy "fornecedores_update" on public.fornecedores for update using (public.is_active_user());
drop policy if exists "fornecedores_delete" on public.fornecedores;
create policy "fornecedores_delete" on public.fornecedores for delete using (public.is_active_user());

drop policy if exists "comparison_fields_select" on public.comparison_fields;
create policy "comparison_fields_select" on public.comparison_fields for select using (public.is_active_user());
drop policy if exists "comparison_fields_insert" on public.comparison_fields;
create policy "comparison_fields_insert" on public.comparison_fields for insert with check (public.is_active_user());
drop policy if exists "comparison_fields_delete" on public.comparison_fields;
create policy "comparison_fields_delete" on public.comparison_fields for delete using (public.is_active_user());

drop policy if exists "reference_values_select" on public.reference_values;
create policy "reference_values_select" on public.reference_values for select using (public.is_active_user());
drop policy if exists "reference_values_insert" on public.reference_values;
create policy "reference_values_insert" on public.reference_values for insert with check (public.is_active_user());
drop policy if exists "reference_values_update" on public.reference_values;
create policy "reference_values_update" on public.reference_values for update using (public.is_active_user());
drop policy if exists "reference_values_delete" on public.reference_values;
create policy "reference_values_delete" on public.reference_values for delete using (public.is_active_user());

-- ---------------------------------------------------------------------------
-- STORAGE — bucket privado para os arquivos enviados
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;

drop policy if exists "storage_select_active" on storage.objects;
create policy "storage_select_active" on storage.objects
  for select using (bucket_id = 'documentos' and public.is_active_user());

drop policy if exists "storage_insert_active" on storage.objects;
create policy "storage_insert_active" on storage.objects
  for insert with check (bucket_id = 'documentos' and public.is_active_user());

drop policy if exists "storage_delete_active" on storage.objects;
create policy "storage_delete_active" on storage.objects
  for delete using (bucket_id = 'documentos' and public.is_active_user());

-- ---------------------------------------------------------------------------
-- PERMISSÕES NAS TABELAS JÁ CRIADAS ACIMA (as linhas de "default privileges"
-- no topo do arquivo só valem para tabelas futuras — estas cobrem as de agora)
-- ---------------------------------------------------------------------------
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;

-- avisa o PostgREST para recarregar a estrutura das tabelas agora —
-- sem isso, mudanças de schema (novas colunas/tabelas) só aparecem para a API
-- depois de um tempo ou de um reload manual, causando erros como
-- "Could not find the 'x' column ... in the schema cache".
notify pgrst, 'reload schema';
