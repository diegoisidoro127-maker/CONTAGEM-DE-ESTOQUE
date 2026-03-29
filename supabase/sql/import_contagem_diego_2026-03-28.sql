-- Import relatório → contagens_estoque + inventario_planilha_linhas
-- Fonte: DIEGO/outros/contagem.xlsx — Gerado automaticamente. data_contagem=2026-03-28
-- Se EAN/DUN estiverem NULL: gere de novo na pasta frontend com frontend/.env e:
--   node scripts/import-relatorio-contagem-xlsx.mjs "<caminho>\contagem.xlsx" --data 2026-03-28 --sql-only --enrich-ean-dun --out ...
-- Conferentes devem existir com nome igual ao Excel (trim).
-- Se faltar coluna origem/inventario_* em contagens_estoque, remova essas colunas do INSERT abaixo.

BEGIN;

CREATE TEMP TABLE _rel_import_staging (
  id uuid NOT NULL,
  lin int NOT NULL,
  conferente_nome text NOT NULL,
  codigo_interno text NOT NULL,
  descricao text NOT NULL,
  unidade_medida text,
  quantidade_up numeric NOT NULL,
  up_adicional numeric,
  lote text,
  observacao text,
  data_fabricacao date,
  data_validade date,
  ean text,
  dun text,
  origem text,
  inventario_repeticao int,
  inventario_numero_contagem int,
  grupo_armazem int,
  rua text,
  posicao int,
  nivel int,
  numero_contagem_planilha int
) ON COMMIT DROP;

INSERT INTO _rel_import_staging (
  id, lin, conferente_nome, codigo_interno, descricao, unidade_medida, quantidade_up, up_adicional,
  lote, observacao, data_fabricacao, data_validade, ean, dun, origem, inventario_repeticao,
  inventario_numero_contagem, grupo_armazem, rua, posicao, nivel, numero_contagem_planilha
) VALUES
  (gen_random_uuid(), 2, 'Pedro', '02.03.0001', 'PAO DE SONHO CONGELADO - CX 2,5KG', 'CX', 45, NULL, '75', NULL, '2026-03-16'::date, '2026-09-12'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 1, 1, 1),
  (gen_random_uuid(), 3, 'Pedro', '02.03.0001', 'PAO DE SONHO CONGELADO - CX 2,5KG', 'CX', 80, NULL, '82', NULL, '2026-03-23'::date, '2026-09-19'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 1, 2, 1),
  (gen_random_uuid(), 4, 'Pedro', '02.03.0001', 'PAO DE SONHO CONGELADO - CX 2,5KG', 'CX', 80, NULL, '82', NULL, '2026-03-23'::date, '2026-09-19'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 1, 3, 1),
  (gen_random_uuid(), 5, 'Pedro', '02.03.0001', 'PAO DE SONHO CONGELADO - CX 2,5KG', 'CX', 80, NULL, '75', NULL, '2026-03-16'::date, '2026-09-12'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 1, 4, 1),
  (gen_random_uuid(), 6, 'Pedro', '02.03.0013', 'PAO DE MINI SONHO CONGELADO - 100UN - CX 2,5KG', 'CX', 80, NULL, '83', NULL, '2026-03-23'::date, '2026-09-19'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 2, 3, 1),
  (gen_random_uuid(), 7, 'Pedro', '01.04.0066', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE REQUEIJÃO 65G – CX 10 KG – 5 UN DE 2 KG', 'CX', 44, 22236, NULL, NULL, '2026-03-25'::date, '2026-09-16'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 4, 1, 1),
  (gen_random_uuid(), 8, 'Pedro', '01.04.0066', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE REQUEIJÃO 65G – CX 10 KG – 5 UN DE 2 KG', 'CX', 22, 22477, NULL, NULL, '2026-03-25'::date, '2026-09-21'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 4, 2, 1),
  (gen_random_uuid(), 9, 'Pedro', '01.04.0066', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE REQUEIJÃO 65G – CX 10 KG – 5 UN DE 2 KG', 'CX', 62, 22524, NULL, NULL, '2026-03-26'::date, '2026-09-22'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 4, 3, 1),
  (gen_random_uuid(), 10, 'Pedro', '01.04.0066', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE REQUEIJÃO 65G – CX 10 KG – 5 UN DE 2 KG', 'CX', 70, 22470, NULL, NULL, '2026-09-25'::date, '2026-09-21'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 4, 4, 1),
  (gen_random_uuid(), 11, 'Pedro', '01.04.0066', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE REQUEIJÃO 65G – CX 10 KG – 5 UN DE 2 KG', 'CX', 70, 22476, NULL, NULL, '2026-03-25'::date, '2026-09-21'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 4, 5, 1),
  (gen_random_uuid(), 12, 'Pedro', '01.09.0007', 'CIABATTA HOMEBAKE TRADICIONAL 3,6KG - 12 UNIDADES 300G', 'CX', 25, NULL, '51', NULL, '2026-02-20'::date, '2026-08-19'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 5, 1, 1),
  (gen_random_uuid(), 13, 'Pedro', '01.09.0007', 'CIABATTA HOMEBAKE TRADICIONAL 3,6KG - 12 UNIDADES 300G', 'CX', 37, 21297, NULL, NULL, '2026-03-02'::date, '2026-08-29'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 5, 2, 1),
  (gen_random_uuid(), 14, 'Pedro', '01.09.0007', 'CIABATTA HOMEBAKE TRADICIONAL 3,6KG - 12 UNIDADES 300G', 'CX', 40, NULL, '65', NULL, '2026-03-06'::date, '2026-09-02'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 5, 3, 1),
  (gen_random_uuid(), 15, 'Pedro', '01.04.0066', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE REQUEIJÃO 65G – CX 10 KG – 5 UN DE 2 KG', 'CX', 70, 22521, NULL, NULL, '2026-03-26'::date, '2026-09-22'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 5, 4, 1),
  (gen_random_uuid(), 16, 'Pedro', '01.09.0008', 'CIABATTA HOMEBAKE COM GRAOS 3,6KG - 12 UNIDADES 300G', 'CX', 16, NULL, '40', NULL, '2026-02-09'::date, '2026-08-08'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 6, 1, 1),
  (gen_random_uuid(), 17, 'Pedro', '01.09.0008', 'CIABATTA HOMEBAKE COM GRAOS 3,6KG - 12 UNIDADES 300G', 'CX', 30, 21057, NULL, NULL, '2026-02-26'::date, '2026-08-25'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 6, 2, 1),
  (gen_random_uuid(), 18, 'Pedro', '01.09.0008', 'CIABATTA HOMEBAKE COM GRAOS 3,6KG - 12 UNIDADES 300G', 'CX', 40, 21062, NULL, NULL, '2026-02-26'::date, '2026-08-25'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 6, 3, 1),
  (gen_random_uuid(), 19, 'Pedro', '01.09.0008', 'CIABATTA HOMEBAKE COM GRAOS 3,6KG - 12 UNIDADES 300G', 'CX', 31, 21675, NULL, NULL, '2026-03-09'::date, '2026-09-05'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 6, 4, 1),
  (gen_random_uuid(), 20, 'Pedro', '01.09.0009', 'MINI PAO ITALIANO HOMEBAKE 4,2KG - 14 UNIDADES 300G', 'CX', 18, NULL, '47', NULL, '2026-02-16'::date, '2026-08-15'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 7, 1, 1),
  (gen_random_uuid(), 21, 'Pedro', '01.09.0009', 'MINI PAO ITALIANO HOMEBAKE 4,2KG - 14 UNIDADES 300G', 'CX', 26, 20580, NULL, NULL, '2026-02-16'::date, '2026-08-15'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 7, 2, 1),
  (gen_random_uuid(), 22, 'Pedro', '01.09.0009', 'MINI PAO ITALIANO HOMEBAKE 4,2KG - 14 UNIDADES 300G', 'CX', 35, 20657, NULL, NULL, '2026-02-17'::date, '2026-08-16'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 7, 3, 1),
  (gen_random_uuid(), 23, 'Pedro', '01.09.0010', 'MINI BAGUETE LANCHE HOMEBAKE 3,6KG - 12 UNIDADES 300G', 'CX', 42, NULL, '56', NULL, '2026-02-25'::date, '2026-08-24'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 8, 1, 1),
  (gen_random_uuid(), 24, 'Pedro', '01.03.0019', 'MASSA CONGELADA DE ROSCA LISA (PAO DE LEITE) - CX 10 KG - 2 UN DE 5KG', 'CX', 7, 2003, NULL, NULL, '2026-03-20'::date, NULL, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 8, 2, 1),
  (gen_random_uuid(), 25, 'Pedro', '01.09.0010', 'MINI BAGUETE LANCHE HOMEBAKE 3,6KG - 12 UNIDADES 300G', 'CX', 40, 21354, NULL, NULL, '2026-03-03'::date, '2026-08-30'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 8, 3, 1),
  (gen_random_uuid(), 26, 'Pedro', '02.02.0049', 'BIG COXINHA PAULISTA DE FRANGO COM REQUEIJÃO FRITA 240G', 'CX', 84, 4028, NULL, NULL, '2026-03-23'::date, '2026-09-19'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 8, 4, 1),
  (gen_random_uuid(), 27, 'Pedro', '02.02.0045', 'RISOLES LAMINADO DE CARNE EMPANADAO COM LINHAÇA 150GR - FRITO', 'CX', 88, 3849, NULL, NULL, '2026-03-23'::date, '2026-09-19'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 8, 5, 1),
  (gen_random_uuid(), 28, 'Pedro', '01.06.0022', 'PAO DE AZEITONA - PCT 3 KG - CX 6 KG', 'CX', 14, NULL, '63', NULL, '2026-03-04'::date, '2026-08-31'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 9, 1, 1),
  (gen_random_uuid(), 29, 'Pedro', '02.03.1003', 'MASSA CONGELADA DE FILAO DE LEITE CAIXA 4X2,5KG 10KG', 'CX', 16, 2002, NULL, NULL, '2026-02-20'::date, '2026-05-21'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 9, 2, 1),
  (gen_random_uuid(), 30, 'Pedro', '02.03.1012', 'MASSA CONGELADA DE PÃO DE BATATA CAIXA 4X2,5KG 10KG', 'CX', 10, 2403, NULL, NULL, '2025-03-24'::date, '2026-06-22'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 9, 3, 1),
  (gen_random_uuid(), 31, 'Pedro', '02.02.0047', 'COXINHA PAULISTA DE FRANGO COM REQUEIJÃO FRITA 150G', 'CX', 84, 4027, NULL, NULL, '2026-03-23'::date, '2026-09-19'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 9, 4, 1),
  (gen_random_uuid(), 32, 'Pedro', '02.02.0048', 'COXINHA PAULISTA DE FRANGO EMPANADA COM ORÉGANO FRITA 150G', 'CX', 84, 4030, NULL, NULL, '2026-03-23'::date, '2026-09-19'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 9, 5, 1),
  (gen_random_uuid(), 33, 'Pedro', '02.02.0038', 'EMPANADA DE CARNE 80G - CX 2,400 - PCT 30 UN', 'CX', 64, NULL, '2', NULL, '2026-03-17'::date, '2026-09-13'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 10, 1, 1),
  (gen_random_uuid(), 34, 'Pedro', '02.03.1013', 'MASSA CONGELADA DE PÃO DA FAZENDA CAIXA 4X2,5KG 10KG', 'CX', 31, 2402, NULL, NULL, '2026-02-24'::date, '2026-05-21'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 10, 2, 1),
  (gen_random_uuid(), 35, 'Pedro', '01.06.0059', 'PAO ITALIANO BOLA 720G - 7 UNIDADES', 'CX', 24, 344, NULL, NULL, '2025-12-10'::date, '2026-06-08'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 10, 3, 1),
  (gen_random_uuid(), 36, 'Pedro', '02.02.0045', 'RISOLES LAMINADO DE CARNE EMPANADAO COM LINHAÇA 150GR - FRITO', 'CX', 84, 3849, NULL, NULL, '2026-03-23'::date, '2026-09-19'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 10, 4, 1),
  (gen_random_uuid(), 37, 'Pedro', '02.02.0045', 'RISOLES LAMINADO DE CARNE EMPANADAO COM LINHAÇA 150GR - FRITO', 'CX', 84, 3849, NULL, NULL, '2026-03-23'::date, '2026-09-19'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 10, 5, 1),
  (gen_random_uuid(), 38, 'Pedro', '01.06.0058', 'PAO ITALIANO FILAO 720G - 7 UNIDADES', 'CX', 27, NULL, '7', NULL, '2026-01-07'::date, '2026-07-06'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 11, 1, 1),
  (gen_random_uuid(), 39, 'Pedro', '02.03.1011', 'MASSA CONGELADA DE PÃO DE CEBOLA CAIXA 4X2,5KG 10KG', 'CX', 12, 902, NULL, NULL, '2026-02-09'::date, '2026-05-10'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 11, 2, 1),
  (gen_random_uuid(), 40, 'Pedro', '02.03.1011', 'MASSA CONGELADA DE PÃO DE CEBOLA CAIXA 4X2,5KG 10KG', 'CX', 35, 1203, NULL, NULL, '2026-03-12'::date, '2026-06-10'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 11, 3, 1),
  (gen_random_uuid(), 41, 'Pedro', '01.04.0007', 'PAO DE QUEIJO TRADICIONAL 30G - CX 10KG', 'CX', 40, NULL, 'D-044', NULL, '2026-02-13'::date, '2026-08-12'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 11, 4, 1),
  (gen_random_uuid(), 42, 'Pedro', '01.06.0002', 'CIABATTA MULTIGRAOS -  PCT 1 KG - CX 4 KG', 'CX', 25, NULL, '304', NULL, '2025-10-31'::date, '2026-04-29'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 12, 1, 1),
  (gen_random_uuid(), 43, 'Pedro', '01.04.0021', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE GOIABADA 65G - 2KG', 'CX', 280, 16874, NULL, NULL, '2025-12-04'::date, '2026-06-02'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 12, 2, 1),
  (gen_random_uuid(), 44, 'Pedro', '02.02.0038', 'EMPANADA DE CARNE 80G - CX 2,400 - PCT 30 UN', 'CX', 128, NULL, '3', NULL, '2026-03-23'::date, '2026-09-19'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 12, 3, 1),
  (gen_random_uuid(), 45, 'Pedro', '02.02.0038', 'EMPANADA DE CARNE 80G - CX 2,400 - PCT 30 UN', 'CX', 128, NULL, '3', NULL, '2026-03-23'::date, '2026-09-19'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 12, 4, 1),
  (gen_random_uuid(), 46, 'Pedro', '02.03.0013', 'PAO DE MINI SONHO CONGELADO - 100UN - CX 2,5KG', 'CX', 31, NULL, '63', NULL, '2026-03-04'::date, '2026-08-31'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 13, 1, 1),
  (gen_random_uuid(), 47, 'Pedro', '02.03.1012', 'MASSA CONGELADA DE PÃO DE BATATA CAIXA 4X2,5KG 10KG', 'CX', 10, 1603, NULL, NULL, '2026-03-16'::date, '2026-06-14'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 13, 2, 1),
  (gen_random_uuid(), 48, 'Pedro', '02.02.0038', 'EMPANADA DE CARNE 80G - CX 2,400 - PCT 30 UN', 'CX', 128, NULL, '3', NULL, '2026-03-17'::date, '2026-09-13'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 13, 3, 1),
  (gen_random_uuid(), 49, 'Pedro', '02.02.0038', 'EMPANADA DE CARNE 80G - CX 2,400 - PCT 30 UN', 'CX', 128, NULL, '3', NULL, '2026-03-17'::date, '2026-09-13'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 13, 4, 1),
  (gen_random_uuid(), 50, 'Pedro', '02.03.1006', 'MASSA CONGELADA TATUZÃO CAIXA 4X2,5KG 10KG', 'CX', 6, 2102, NULL, NULL, '2026-02-21'::date, '2026-05-22'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 14, 2, 1),
  (gen_random_uuid(), 51, 'Pedro', '02.03.1007', 'MASSA CONGELADA TATU CAIXA 4X2,5KG 10KG', 'CX', 8, 2102, NULL, NULL, '2026-02-21'::date, '2026-05-22'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 14, 2, 1),
  (gen_random_uuid(), 52, 'Pedro', '01.04.0006', 'MASSA CONGELADA DE PAO DE QUEIJO RECHEADO COM REQUEIJAO BENJAMIN DE 100G - 1KG', 'PT', 42, NULL, 'D-019', NULL, '2026-01-19'::date, '2026-07-18'::date, NULL, NULL, 'inventario', NULL, 1, 1, 'V', 15, 1, 1);

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM _rel_import_staging s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.conferentes c WHERE trim(c.nome) = trim(s.conferente_nome)
    )
  ) THEN
    RAISE EXCEPTION 'Conferente não encontrado em public.conferentes (nome deve ser igual ao da planilha, após trim).';
  END IF;
END
$guard$;

INSERT INTO public.contagens_estoque (
  id,
  data_contagem,
  data_hora_contagem,
  conferente_id,
  produto_id,
  codigo_interno,
  descricao,
  unidade_medida,
  quantidade_up,
  up_adicional,
  lote,
  observacao,
  data_fabricacao,
  data_validade,
  ean,
  dun,
  foto_base64,
  origem,
  inventario_repeticao,
  inventario_numero_contagem
)
SELECT
  s.id,
  '2026-03-28'::date,
  '2026-03-28T15:00:00.000Z'::timestamptz,
  c.id,
  NULL::uuid,
  s.codigo_interno,
  s.descricao,
  s.unidade_medida,
  s.quantidade_up,
  s.up_adicional,
  s.lote,
  s.observacao,
  s.data_fabricacao,
  s.data_validade,
  s.ean,
  s.dun,
  NULL,
  s.origem,
  s.inventario_repeticao,
  s.inventario_numero_contagem
FROM _rel_import_staging s
JOIN public.conferentes c ON trim(c.nome) = trim(s.conferente_nome);

INSERT INTO public.inventario_planilha_linhas (
  conferente_id,
  data_inventario,
  grupo_armazem,
  rua,
  posicao,
  nivel,
  numero_contagem,
  codigo_interno,
  descricao,
  inventario_repeticao,
  quantidade,
  data_fabricacao,
  data_validade,
  lote,
  up_quantidade,
  observacao,
  produto_id,
  contagens_estoque_id
)
SELECT
  c.id,
  '2026-03-28'::date,
  s.grupo_armazem,
  s.rua,
  s.posicao,
  s.nivel,
  s.numero_contagem_planilha,
  s.codigo_interno,
  s.descricao,
  s.inventario_repeticao,
  s.quantidade_up,
  s.data_fabricacao,
  s.data_validade,
  s.lote,
  s.up_adicional,
  s.observacao,
  NULL::uuid,
  s.id
FROM _rel_import_staging s
JOIN public.conferentes c ON trim(c.nome) = trim(s.conferente_nome)
WHERE s.grupo_armazem IS NOT NULL;

COMMIT;
