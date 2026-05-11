/**
 * Gera supabase/sql/upsert_todos_os_produtos_lista_contagem_armazem_88.sql
 * a partir dos 88 códigos da lista armazém (mesma ordem que armazemInventarioMap.ts).
 *
 * Rode: node scripts/gen-upsert-todos-produtos-armazem-88.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Ordem = grupos 1–4 em armazemInventarioMap.ts; descrição/unidade = lista enviada ao app. */
const ROWS = [
  ['01.01.0001', 'MASSA CONGELADA DE PAO FRANCES RAPIDA - 5KG', 'PT'],
  ['01.01.0002', 'MASSA CONGELADA DE PAO FRANCES MEDIA - 5KG', 'PT'],
  ['01.02.0001', 'MASSA CONGELADA DE MINI PAO FRANCES RAPIDA - 5KG', 'PT'],
  ['01.02.0003', 'MASSA CONGELADA DE MINI PAO FRANCES INTEGRAL RAPIDA - 5KG', 'PT'],
  ['01.02.0005', 'MASSA CONGELADA DE PAO FRANCES INTEGRAL RAPIDA - 5KG', 'PT'],
  ['01.02.0007', 'MASSA CONGELADA DE PAO FRANCES COM GRAOS RAPIDA - 5KG', 'PT'],
  ['01.04.0008', 'PAO DE QUEIJO EMPANADO 30G - CX 10KG - 5 UN DE 2KG', 'CX'],
  ['01.04.0009', 'PAO DE QUEIJO MULTIGRAOS EMPANADO 30G - CX 10KG - 5 UN DE 2KG', 'CX'],
  ['01.04.0019', 'MASSA CONGELADA DE CHIPA QUEIJO CANASTRA 45G - 4KG', 'PT'],
  ['01.04.0020', 'MASSA CONGELADA DE BISCOITO PALITO 3 QUEIJOS 45G - 4KG', 'PT'],
  ['01.04.0021', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE GOIABADA 65G - 2KG', 'PT'],
  ['01.04.0022', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE REQUEIJÃO 65G - 2KG', 'PT'],
  ['01.10.0003', 'CIABATTA TRADICINAL LEVIASSA 220G', 'CX'],
  ['01.10.0004', 'CIABATTA COM GRAOS LEVIASSA', 'CX'],
  ['01.10.0006', 'MINI BAGUETE FRANCESA LEVIASSA 240 G', 'CX'],
  ['01.02.0009', 'MASSA CONGELADA DE BAGUETE RAPIDA - 5KG', 'PT'],
  ['01.02.0011', 'MASSA CONGELADA DE MINI BAGUETE RAPIDA - 5KG', 'PT'],
  ['01.04.0006', 'PAO DE QUEIJO RECHEADO COM REQUEIJAO BENJAMIN DE 100G - 1KG', 'PT'],
  ['01.03.0019', 'ROSCA LISA (PAO DE LEITE) - CX 10 KG -2 UN DE 5 KG', 'CX'],
  ['01.04.0001', 'MASSA CONGELADA DE PAO DE QUEIJO TRADICIONAL PEQUENO 30G - 7KG', 'PT'],
  ['01.04.0002', 'MASSA CONGELADA DE PAO DE QUEIJO TRADICIONAL GRANDE 90G - 7KG', 'PT'],
  ['02.04.0001', 'MASSA CONGELADA DE PAO FRANCES BOLA RAPIDA - 5KG', 'PT'],
  ['02.01.0005', 'CP PAO DE QUEIJO TRADICIONAL - MAX LANCHE', 'CX'],
  ['02.01.0004', 'CP PAO DE QUEIJO RECHEADO REQUEIJÃO', 'CX'],
  ['01.10.0013', 'MINI BAGUETE FRANCESA LEVIASSA PT 220G CX 3,17 KG', 'CX'],
  ['01.10.0014', 'CIABATTA TRADICINAL LEVIASSA PT 220G CX 3,17 KG', 'CX'],
  ['01.04.0066', 'PAO DE QUEIJO RECHEADO COM REQUEIJÃO 65G - 2KG', 'CX'],
  ['01.09.0007', 'CIABATTA HOMEBAKE TRADICIONAL 3,6KG - 12 UNIDADES 300G', 'CX'],
  ['01.09.0008', 'CIABATTA HOMEBAKE COM GRAOS 3,6KG - 12 UNIDADES 300G', 'CX'],
  ['01.09.0009', 'MINI PAO ITALIANO HOMEBAKE 4,2KG - 14 UNIDADES 300G', 'CX'],
  ['01.09.0010', 'MINI BAGUETE LANCHE HOMEBAKE 3,6KG - 12 UNIDADES 300G', 'CX'],
  ['01.09.0011', 'PAO DE HAMBURGUER HOMEBAKE CROC 3,12KG - 12 UNIDADES 260G', 'CX'],
  ['01.09.0012', 'PAO FRANCES HOMEBAKE 3,24KG - 12 UNIDADES 270G', 'CX'],
  ['01.06.0001', 'CIABATTA TRADICIONAL - 10UN - PCT 1 KG - CX 4 KG', 'CX'],
  ['01.06.0002', 'CIABATTA MULTIGRAOS - 10UN - 1KG', 'CX'],
  ['01.06.0059', 'PAO ITALIANO BOLA 720G - 7 UNIDADES', 'CX'],
  ['02.03.0001', 'PAO DE SONHO CONGELADO - CX 2,5KG', 'CX'],
  ['02.03.0039', 'BAGUETE CALABRESA COM CEBOLA CARAMELIZADA 140G', 'CX'],
  ['02.03.0042', 'BAGUETE PARMESAO PERNIL - CX 10UN', 'CX'],
  ['02.02.0045', 'RISOLES DE CARNE EMPANADA COM LINHAÇA 150G - FRITO', 'CX'],
  ['02.03.0041', 'BOLO DE CENOURA C/ COBERTURA - 2UN', 'CX'],
  ['02.03.0013', 'PAO DE MINI SONHO CONGELADO - 100 UN - CX 2,5KG', 'CX'],
  ['01.04.0063', 'MASSA CONGELADA DE CHIPA QUEIJO CANASTRA 45G - 4KG CX', 'PT'],
  ['01.04.0064', 'MASSA CONGELADA DE BISCOITO PALITO 3 QUEIJOS 45G - 4KG CX', 'CX'],
  ['02.02.0038', 'EMPANADA DE CARNE 80G - CX 2.400 - PCT 30 UN', 'CX'],
  ['02.02.0044', 'RISOLES LAMINADO DE PRESUNTO E QUEIJO FRITO 150G', 'CX'],
  ['02.02.0047', 'COXINHA PAULISTA DE FRANGO COM REQUEIJÃO FRITA 150G', 'CX'],
  ['02.02.0048', 'COXINHA PAULISTA DE FRANGO EMPANADA COM ORÉGANO FRITA 150G', 'CX'],
  ['02.02.0049', 'BIG COXINHA PAULISTA DE FRANGO COM REQUEIJÃO FRITA 240G', 'CX'],
  ['02.02.0050', 'SALSICHA EMPANADA SUP CROCANTE FRITA 120G', 'CX'],
  ['02.01.0007', 'MASSA CONGELADA DE PALITO 3 QUEIJOS - CX 12KG - PT 6 UM', 'CX'],
  ['02.02.0034', 'MASSA CONGELADA DE CROISSANT DE FRANGO COM REQUEIJAO - 12KG', 'CX'],
  ['02.02.0033', 'MASSA CONGELADA DE CROISSANT DE CHOCOLATE - 12KG', 'CX'],
  ['02.02.0046', 'EMPADA DE FRANGO MASSA TUNG C/ 12 UND CAIXA C/ 6 PCTS', 'CX'],
  ['02.02.0036', 'MASSA CONGELADA DE CROISSANT SEM RECHEIO 12KG', 'CX'],
  ['02.02.0035', 'MASSA CONGELADA DE CROISSANT DE QUEIJO E PRESUNTO FATIADO - 12KG', 'CX'],
  ['02.02.0032', 'MASSA CONGELADA DE CROISSANT DE 3 QUEIJOS - 11KG', 'CX'],
  ['01.04.0014', 'MASSA CONGELADA DE PAO DE QUEIJO ST MARCHE 30G - CX 8KG - 20 UN DE 400G', 'CX'],
  ['01.04.0025', 'MASSA CONGELADA DE CHIPA QUEIJO CANASTRA ST MARCHE 45G - 20 PCTS DE 400G', 'CX'],
  ['01.04.0026', 'MASSA CONGELADA DE BISCOITO PALITO 3 QUEIJOS ST MARCHE 45G - 20 PCTS DE 400G', 'CX'],
  ['01.04.0054', 'PAO DE QUEIJO RECHEADO DE GOIABADA ST MARCHE 30G - 20 PCTS DE 400G', 'CX'],
  ['01.04.0055', 'M. CONG. DE PAO DE QUEIJO RECHEADO DE REQUEIJAO ST MARCHE 30G - 20 PCTS DE 400G', 'CX'],
  ['02.04.0002', 'PAO PARA HOT DOG 60G - 50 UNIDADES - 3,000 KG', 'PT'],
  ['01.06.0058', 'PAO ITALIANO FILAO - CX 5,04KG - 7 UN DE 720G', 'CX'],
  ['01.06.0022', 'PAO DE AZEITONA 500G - 3KG', 'CX'],
  ['01.06.0024', 'PAO DE CALABRESA 500G - 3KG', 'CX'],
  ['01.04.0007', 'PAO DE QUEIJO TRADICIONAL 30G - CX 10KG', 'CX'],
  ['02.03.1003', 'MASSA CONGELADA DE FILAO DE LEITE CAIXA 4X2,5KG 10KG', 'CX'],
  ['02.03.1004', 'MASSA CONGELADA DE BISNAGUINHA CAIXA 4X2,5KG 10KG', 'CX'],
  ['02.03.1005', 'MASSA CONGELADA DE BENGALA CAIXA 4X2,5KG 10KG', 'CX'],
  ['02.03.1006', 'MASSA CONGELADA TATUZÃO CAIXA 4X2,5KG 10KG', 'CX'],
  ['02.03.1007', 'MASSA CONGELADA TATU CAIXA 4X2,5KG 10KG', 'CX'],
  ['02.03.1008', 'MASSA CONGELADA ROSCA CARACOL CAIXA 4X2,5KG 10KG', 'CX'],
  ['02.03.1009', 'MASSA CONGELADA ROSCA TRANÇADA GRANDE CAIXA 4X2,5KG 10KG', 'CX'],
  ['02.03.1010', 'MASSA CONGELADA DE PÃO DE MILHO CAIXA 4X2,5KG 10KG', 'CX'],
  ['02.03.1011', 'MASSA CONGELADA DE PÃO DE CEBOLA CAIXA 4X2,5KG 10KG', 'CX'],
  ['02.03.1012', 'MASSA CONGELADA DE PÃO DE BATATA CAIXA 4X2,5KG 10KG', 'CX'],
  ['02.03.1013', 'MASSA CONGELADA DE PÃO DA FAZENDA CAIXA 4X2,5KG 10KG', 'CX'],
  ['02.03.1014', 'MASSA CONGELADA DE HOT DOG CAIXA 4X2,5KG 10KG', 'CX'],
  ['02.03.1015', 'MASSA CONGELADA DE PÃO DE HAMBURGUÉR CAIXA 4X2,5KG 10KG', 'CX'],
  ['02.03.1016', 'MASSA CONGELADA DE FORROZINHO COM CREME E CHOCOLATE CAIXA 4X2,5KG 10KG', 'CX'],
  ['02.03.1017', 'MASSA CONGELADA DE FORROZINHO COM CREME E COCO CAIXA 4X2,5KG 10KG', 'CX'],
  ['01.04.0058', 'MASSA CONGELADA DE PÃO DE QUEIJO TRAD. PEQUENO- CX 10 KG- 5UN DE 2 KG', 'CX'],
  ['01.04.0062', 'MASSA CONGELADA DE PÃO DE QUEIJO TRADICIONAL GRANDE - CX 10 KG - 5 UN DE 2 KG', 'CX'],
  ['01.04.0067', 'MASSA CONGELADA DE PAO DE QUEIJO RECHEADO COM GOIABADA - CX 10 KG - 5 UN DE 2 KG', 'CX'],
  ['01.04.0060', 'MASSA CONGELADA DE PAO DE QUEIJO RECHEADO COM REQUEIJAO - CX 10 KG - 5 UN DE 2 KG', 'CX'],
  ['01.04.0068', 'MASSA CONGELADA DE PÃO DE QUEIJO COQUETEL EMPANADO - CX 10KG - 5 UN', 'CX'],
  ['01.04.0061', 'MASSA CONGELADA DE CHIPA TRADICIONAL - CX 10 KG - 5 UN DE 2 KG', 'CX'],
]

function sqlStr(s) {
  return String(s).replace(/'/g, "''")
}

if (ROWS.length !== 88) {
  console.error('Esperado 88 linhas, tem', ROWS.length)
  process.exit(1)
}

const values = ROWS.map(
  ([c, d, u]) => `  ('${sqlStr(c)}', '${sqlStr(d)}', '${sqlStr(u)}')`,
).join(',\n')

const header = `-- Upsert dos 88 produtos da lista oficial de contagem armazém (1ª–4ª contagem).
-- Alinha com frontend/src/lib/armazemInventarioMap.ts (mesmos códigos e ordem de rota).
--
-- O que faz:
--   • Atualiza descricao (e unidade/unidade_medida, se a coluna existir) para os códigos desta lista.
--   • Insere linhas que ainda não existem em public."Todos os Produtos".
--   • NÃO remove outros produtos fora desta lista (diferente de sync_todos_os_produtos_lista.sql).
--
-- Rode no Supabase: SQL Editor → Run (recomendado dentro de begin/commit já abaixo).

`

const body = `begin;

-- Normaliza espaços no código (evita duplicidade lógica).
update public."Todos os Produtos"
set codigo_interno = trim(both from codigo_interno)
where codigo_interno is not null
  and codigo_interno <> trim(both from codigo_interno);

create temporary table _stg_armazem88 (
  codigo_interno text primary key,
  descricao text not null,
  unidade text not null
) on commit drop;

insert into _stg_armazem88 (codigo_interno, descricao, unidade) values
${values};

-- Atualiza descrição oficial.
update public."Todos os Produtos" t
set descricao = s.descricao
from _stg_armazem88 s
where trim(both from t.codigo_interno) = s.codigo_interno
  and coalesce(t.descricao, '') is distinct from s.descricao;

-- Atualiza unidade (compatível com coluna unidade ou unidade_medida).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'Todos os Produtos' and column_name = 'unidade'
  ) then
    update public."Todos os Produtos" t
    set unidade = s.unidade
    from _stg_armazem88 s
    where trim(both from t.codigo_interno) = s.codigo_interno
      and coalesce(t.unidade, '') is distinct from s.unidade;
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'Todos os Produtos' and column_name = 'unidade_medida'
  ) then
    update public."Todos os Produtos" t
    set unidade_medida = s.unidade
    from _stg_armazem88 s
    where trim(both from t.codigo_interno) = s.codigo_interno
      and coalesce(t.unidade_medida, '') is distinct from s.unidade;
  end if;
end $$;

-- Insere códigos ainda ausentes.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'Todos os Produtos' and column_name = 'unidade'
  ) then
    insert into public."Todos os Produtos" (codigo_interno, descricao, unidade)
    select s.codigo_interno, s.descricao, s.unidade
    from _stg_armazem88 s
    where not exists (
      select 1 from public."Todos os Produtos" t
      where trim(both from t.codigo_interno) = s.codigo_interno
    );
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'Todos os Produtos' and column_name = 'unidade_medida'
  ) then
    insert into public."Todos os Produtos" (codigo_interno, descricao, unidade_medida)
    select s.codigo_interno, s.descricao, s.unidade
    from _stg_armazem88 s
    where not exists (
      select 1 from public."Todos os Produtos" t
      where trim(both from t.codigo_interno) = s.codigo_interno
    );
  else
    insert into public."Todos os Produtos" (codigo_interno, descricao)
    select s.codigo_interno, s.descricao
    from _stg_armazem88 s
    where not exists (
      select 1 from public."Todos os Produtos" t
      where trim(both from t.codigo_interno) = s.codigo_interno
    );
  end if;
end $$;

commit;

-- Conferência (opcional): filtre por um código, ex. 01.04.0007, e confira descricao/unidade.
`

const outPath = path.join(__dirname, '../supabase/sql/upsert_todos_os_produtos_lista_contagem_armazem_88.sql')
fs.writeFileSync(outPath, header + body, 'utf8')
console.log('Gerado:', outPath, 'linhas ROWS:', ROWS.length)
