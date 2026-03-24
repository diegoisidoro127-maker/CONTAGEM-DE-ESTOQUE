-- Sincroniza public.produtos com a lista oficial (código + descrição).
-- Mantém ean, dun e unidade_medida dos registros existentes quando o codigo_interno coincide.
-- Remove do cadastro qualquer produto que NÃO esteja nesta lista.
--
-- Rode no Supabase: SQL Editor → New query → colar → Run.

begin;

create temporary table tmp_oficial (
  codigo_interno text primary key,
  descricao text not null
);

insert into tmp_oficial (codigo_interno, descricao) values
  ('01.01.0001', 'MASSA CONGELADA DE PAO FRANCES RAPIDA - 5KG'),
  ('01.01.0002', 'MASSA CONGELADA DE PAO FRANCES MEDIA - 5KG'),
  ('01.02.0001', 'MASSA CONGELADA DE MINI PAO FRANCES RAPIDA - 5KG'),
  ('01.02.0003', 'MASSA CONGELADA DE MINI PAO FRANCES INTEGRAL RAPIDA - 5KG'),
  ('01.02.0005', 'MASSA CONGELADA DE PAO FRANCES INTEGRAL RAPIDA - 5KG'),
  ('01.02.0007', 'MASSA CONGELADA DE PAO FRANCES COM GRAOS RAPIDA - 5KG'),
  ('01.04.0008', 'PAO DE QUEIJO EMPANADO 30G - CX 10KG - 5 UN DE 2KG'),
  ('01.04.0009', 'PAO DE QUEIJO MULTIGRAOS EMPANADO 30G - CX 10KG - 5 UN DE 2KG'),
  ('01.04.0019', 'MASSA CONGELADA DE CHIPA QUEIJO CANASTRA 45G - 4KG'),
  ('01.04.0020', 'MASSA CONGELADA DE BISCOITO PALITO 3 QUEIJOS 45G - 4KG'),
  ('01.04.0021', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE GOIABADA 65G - 2KG'),
  ('01.04.0022', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE REQUEIJÃO 65G - 2KG'),
  ('01.10.0005', 'MINI PAO ITALIANO LEVIASSA 240G'),
  ('01.10.0003', 'CIABATTA TRADICINAL LEVIASSA 220G'),
  ('01.10.0004', 'CIABATTA COM GRAOS LEVIASSA'),
  ('01.10.0006', 'MINI BAGUETE FRANCESA LEVIASSA 240 G'),
  ('01.02.0009', 'MASSA CONGELADA DE BAGUETE RAPIDA - 5KG'),
  ('01.02.0011', 'MASSA CONGELADA DE MINI BAGUETE RAPIDA - 5KG'),
  ('01.04.0005', 'PAO DE QUEIJO RECHEADO COM GOIABADA BENJAMIN DE 100G - 1KG'),
  ('01.04.0006', 'PAO DE QUEIJO RECHEADO COM REQUEIJAO BENJAMIN DE 100G - 1KG'),
  ('01.03.0019', 'ROSCA LISA (PAO DE LEITE) - CX 10 KG -2 UN DE 5 KG'),
  ('01.04.0001', 'MASSA CONGELADA DE PAO DE QUEIJO TRADICIONAL PEQUENO 30G - 7KG'),
  ('01.04.0002', 'MASSA CONGELADA DE PAO DE QUEIJO TRADICIONAL GRANDE 90G - 7KG'),
  ('02.04.0001', 'MASSA CONGELADA DE PAO FRANCES BOLA RAPIDA - 5KG'),
  ('02.01.0005', 'CP PAO DE QUEIJO TRADICIONAL - MAX LANCHE'),
  ('02.01.0004', 'CP PAO DE QUEIJO RECHEADO REQUEIJÃO'),
  ('01.10.0013', 'MINI BAGUETE FRANCESA LEVIASSA PT 220G CX 3,17 KG'),
  ('01.10.0014', 'CIABATTA TRADICINAL LEVIASSA PT 220G CX 3,17 KG'),
  ('01.04.0057', 'PAO DE QUEIJO RECHEADO REQUEIJÃO 30G OXXO'),
  ('01.04.0066', 'PAO DE QUEIJO RECHEADO COM REQUEIJÃO 65G - 2KG');

-- Atualiza descrição; não mexe em ean, dun, unidade_medida
update public.produtos p
set descricao = t.descricao
from tmp_oficial t
where p.codigo_interno = t.codigo_interno;

-- Inclui códigos novos (sem ean/dun até você cadastrar)
insert into public.produtos (codigo_interno, descricao)
select t.codigo_interno, t.descricao
from tmp_oficial t
where not exists (
  select 1 from public.produtos p where p.codigo_interno = t.codigo_interno
);

-- Remove o que não está na lista (contagens antigas mantêm snapshot; produto_id pode virar NULL)
delete from public.produtos p
where not exists (
  select 1 from tmp_oficial t where t.codigo_interno = p.codigo_interno
);

commit;
