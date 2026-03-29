-- Import relatório → contagens_estoque + inventario_planilha_linhas
-- Gerado automaticamente. data_contagem=2026-03-28
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
  (gen_random_uuid(), 2, 'Bruno', '01.04.0008', 'PAO DE QUEIJO EMPANADO 30G - CX 10KG - 5 UN DE 2KG', 'CX', 50, NULL, 'C-084', NULL, '2026-03-25'::date, '2026-09-21'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 1, 1, 1),
  (gen_random_uuid(), 3, 'Bruno', '01.04.0008', 'PAO DE QUEIJO EMPANADO 30G - CX 10KG - 5 UN DE 2KG', 'CX', 70, 22516, NULL, NULL, '2026-03-26'::date, '2026-09-22'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 1, 3, 1),
  (gen_random_uuid(), 4, 'Bruno', '01.04.0008', 'PAO DE QUEIJO EMPANADO 30G - CX 10KG - 5 UN DE 2KG', 'CX', 70, 22426, NULL, NULL, '2026-03-25'::date, '2026-09-21'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 1, 4, 1),
  (gen_random_uuid(), 5, 'Bruno', '01.04.0008', 'PAO DE QUEIJO EMPANADO 30G - CX 10KG - 5 UN DE 2KG', 'CX', 70, 22262, NULL, NULL, '2026-03-21'::date, '2026-09-17'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 1, 4, 1),
  (gen_random_uuid(), 6, 'Bruno', '02.03.1017', 'MASSA CONGELADA DE FORROZINHO COM CREME E COCO CAIXA 4X2,5KG 10KG', 'CX', 1, 300126, NULL, NULL, '2026-01-30'::date, '2026-04-30'::date, '7898967145789', '17898967145786', 'inventario', NULL, 1, 2, 'U', 2, 1, 1),
  (gen_random_uuid(), 7, 'Bruno', '01.04.0020', 'MASSA CONGELADA DE BISCOITO PALITO 3 QUEIJOS 45G - 4KG', 'PT', 6, NULL, 'C-073', NULL, '2026-03-14'::date, '2026-09-10'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 2, 1, 1),
  (gen_random_uuid(), 8, 'Bruno', '02.03.1016', 'MASSA CONGELADA DE FORROZINHO COM CREME E CHOCOLATE CAIXA 4X2,5KG 10KG', 'CX', 1, 300126, NULL, NULL, '2026-01-30'::date, '2026-04-30'::date, '7898967145772', '17898967145779', 'inventario', NULL, 1, 2, 'U', 2, 1, 1),
  (gen_random_uuid(), 9, 'Bruno', '02.03.1017', 'MASSA CONGELADA DE FORROZINHO COM CREME E COCO CAIXA 4X2,5KG 10KG', 'CX', 1, 300126, NULL, NULL, '2026-01-30'::date, '2026-04-30'::date, '7898967145789', '17898967145786', 'inventario', NULL, 1, 2, 'U', 2, 2, 1),
  (gen_random_uuid(), 10, 'Bruno', '02.03.1015', 'MASSA CONGELADA DE PÃO DE HAMBURGUÉR CAIXA 4X2,5KG 10KG', 'CX', 21, 9022026, NULL, NULL, '2026-02-09'::date, '2026-05-10'::date, '7898967145765', '17898967145762', 'inventario', NULL, 1, 2, 'U', 2, 3, 1),
  (gen_random_uuid(), 11, 'Bruno', '02.02.0044', 'RISOLES LAMINADO DE PRESUNTO E QUEIJO FRITO 150G', NULL, 84, 100326, NULL, NULL, '2026-03-10'::date, '2026-09-06'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 2, 4, 1),
  (gen_random_uuid(), 12, 'Bruno', '01.04.0008', 'PAO DE QUEIJO EMPANADO 30G - CX 10KG - 5 UN DE 2KG', 'CX', 70, 22216, NULL, NULL, '2026-03-20'::date, '2026-09-16'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 2, 5, 1),
  (gen_random_uuid(), 13, 'Bruno', '01.04.0058', 'MASSA CONGELADA DE PÃO DE QUEIJO TRAD. PEQUENO- CX 10 KG- 5UN DE 2 KG', 'CX', 27, NULL, 'D-078', NULL, '2026-03-18'::date, '2026-09-15'::date, '7898694173758', '17898694173755', 'inventario', NULL, 1, 2, 'U', 3, 1, 1),
  (gen_random_uuid(), 14, 'Bruno', '02.03.1015', 'MASSA CONGELADA DE PÃO DE HAMBURGUÉR CAIXA 4X2,5KG 10KG', 'CX', 4, 290126, NULL, NULL, '2026-01-29'::date, '2026-03-30'::date, '7898967145765', '17898967145762', 'inventario', NULL, 1, 2, 'U', 3, 2, 1),
  (gen_random_uuid(), 15, 'Bruno', '02.03.1011', 'MASSA CONGELADA DE PÃO DE CEBOLA CAIXA 4X2,5KG 10KG', 'CX', 5, 300126, NULL, NULL, '2026-01-30'::date, '2026-03-31'::date, '7898967145727', '17898967145724', 'inventario', NULL, 1, 2, 'U', 3, 2, 1),
  (gen_random_uuid(), 16, 'Bruno', '02.01.0007', 'MASSA CONGELADA DE PALITO 3 QUEIJOS - 2KG', 'CX', 10, 120326, NULL, NULL, '2026-03-12'::date, '2026-09-08'::date, NULL, '17898958973398', 'inventario', NULL, 1, 2, 'U', 3, 3, 1),
  (gen_random_uuid(), 17, 'Bruno', '01.04.0008', 'PAO DE QUEIJO EMPANADO 30G - CX 10KG - 5 UN DE 2KG', 'CX', 70, 22567, NULL, NULL, '2026-03-27'::date, '2026-09-23'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 3, 4, 1),
  (gen_random_uuid(), 18, 'Bruno', '01.04.0008', 'PAO DE QUEIJO EMPANADO 30G - CX 10KG - 5 UN DE 2KG', 'CX', 70, 22269, NULL, NULL, '2026-03-21'::date, '2026-09-17'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 3, 5, 1),
  (gen_random_uuid(), 19, 'Bruno', '01.04.0009', 'PAO DE QUEIJO MULTIGRAOS EMPANADO 30G - CX 10KG - 5 UN DE 2KG', 'CX', 40, NULL, 'C-063', NULL, '2026-03-04'::date, '2026-08-31'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 4, 1, 1),
  (gen_random_uuid(), 20, 'Bruno', '02.03.1009', 'MASSA CONGELADA ROSCA TRANÇADA GRANDE CAIXA 4X2,5KG 10KG', 'CX', 5, 110226, NULL, NULL, '2026-02-11'::date, '2026-05-12'::date, '7898967145703', '17898967145700', 'inventario', NULL, 1, 2, 'U', 4, 2, 1),
  (gen_random_uuid(), 21, 'Bruno', '01.04.0064', 'MASSA CONGELADA DE BISCOITO PALITO 3 QUEIJOS 45G - 4KG CX', NULL, 30, NULL, 'O-079', NULL, '2026-03-20'::date, '2026-09-16'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 4, 3, 1),
  (gen_random_uuid(), 22, 'Bruno', '01.04.0008', 'PAO DE QUEIJO EMPANADO 30G - CX 10KG - 5 UN DE 2KG', 'CX', 70, 22520, NULL, NULL, '2026-03-26'::date, '2026-09-22'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 4, 4, 1),
  (gen_random_uuid(), 23, 'Bruno', '01.04.0008', 'PAO DE QUEIJO EMPANADO 30G - CX 10KG - 5 UN DE 2KG', 'CX', 70, 22386, NULL, NULL, '2026-03-24'::date, '2026-09-20'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 4, 5, 1),
  (gen_random_uuid(), 24, 'Bruno', '01.04.0022', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE REQUEIJÃO 65G - 2KG', 'PT', 164, NULL, 'C-054', NULL, '2026-02-23'::date, '2026-08-22'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 5, 1, 1),
  (gen_random_uuid(), 25, 'Bruno', '02.03.1014', 'MASSA CONGELADA DE HOT DOG CAIXA 4X2,5KG 10KG', 'CX', 15, 90226, NULL, NULL, '2026-02-09'::date, '2026-05-10'::date, '7898967145758', '17898967145755', 'inventario', NULL, 1, 2, 'U', 5, 2, 1),
  (gen_random_uuid(), 26, 'Bruno', '02.03.0042', 'BAGUETE PARMESAO PERNIL - CX 10UN', 'CX', 128, 100326, NULL, NULL, '2026-03-10'::date, '2026-08-06'::date, NULL, '17898914427828', 'inventario', NULL, 1, 2, 'U', 5, 3, 1),
  (gen_random_uuid(), 27, 'Bruno', '02.03.1004', 'MASSA CONGELADA DE BISNAGUINHA CAIXA 4X2,5KG 10KG', 'CX', 12, 110226, NULL, NULL, '2026-02-11'::date, '2026-05-12'::date, '7898967145666', '17898967145663', 'inventario', NULL, 1, 2, 'U', 5, 4, 1),
  (gen_random_uuid(), 28, 'Bruno', '02.03.1014', 'MASSA CONGELADA DE HOT DOG CAIXA 4X2,5KG 10KG', 'CX', 22, 180226, NULL, NULL, '2026-02-18'::date, '2026-05-19'::date, '7898967145758', '17898967145755', 'inventario', NULL, 1, 2, 'U', 5, 5, 1),
  (gen_random_uuid(), 29, 'Bruno', '01.04.0002', 'MASSA CONGELADA DE PAO DE QUEIJO TRADICIONAL GRANDE 90G - 7KG', 'PT', 1, NULL, 'O-356', NULL, '2026-03-20'::date, '2026-06-20'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 6, 1, 1),
  (gen_random_uuid(), 30, 'Bruno', '01.04.0001', 'MASSA CONGELADA DE PAO DE QUEIJO TRADICIONAL PEQUENO 30G - 7KG', 'PT', 13, NULL, 'O-021', NULL, '2026-01-20'::date, '2026-07-20'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 6, 1, 1),
  (gen_random_uuid(), 31, 'Bruno', '01.04.0062', 'MASSA CONGELADA DE PÃO DE QUEIJO TRADICIONAL GRANDE - CX 10 KG - 5 UN DE 2 KG', 'CX', 17, NULL, 'O-027', NULL, '2026-01-27'::date, '2026-07-26'::date, '7898694173765', '17898694173762', 'inventario', NULL, 1, 2, 'U', 6, 2, 1),
  (gen_random_uuid(), 32, 'Bruno', '01.04.0022', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE REQUEIJÃO 65G - 2KG', 'PT', 220, NULL, 'C-070', NULL, '2026-03-11'::date, '2026-09-07'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 6, 3, 1),
  (gen_random_uuid(), 33, 'Bruno', '01.04.0022', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE REQUEIJÃO 65G - 2KG', 'PT', 280, 20860, NULL, NULL, '2026-02-24'::date, '2026-08-22'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 6, 4, 1),
  (gen_random_uuid(), 34, 'Bruno', '01.04.0022', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE REQUEIJÃO 65G - 2KG', 'PT', 280, 20846, NULL, NULL, '2026-02-23'::date, '2026-08-22'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 6, 5, 1),
  (gen_random_uuid(), 35, 'Bruno', '01.04.0019', 'MASSA CONGELADA DE CHIPA QUEIJO CANASTRA 45G - 4KG', 'PT', 45, NULL, 'D-75', NULL, '2026-03-16'::date, '2026-09-12'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 7, 1, 1),
  (gen_random_uuid(), 36, 'Bruno', '01.09.0009', 'MINI PAO ITALIANO HOMEBAKE 4,2KG - 14 UNIDADES 300G', 'CX', 22, 21628, NULL, NULL, NULL, NULL, '7898694170047', '7898694170047', 'inventario', NULL, 1, 2, 'U', 7, 2, 1),
  (gen_random_uuid(), 37, 'Bruno', '02.04.0002', 'PAO PARA HOT DOG 60G - 50 UNIDADES - 3,000 KG', 'PT', 40, 87049, NULL, NULL, '2026-01-08'::date, '2026-04-08'::date, '7898059712721', '7898059712721', 'inventario', NULL, 1, 2, 'U', 7, 3, 1),
  (gen_random_uuid(), 38, 'Bruno', '01.04.0058', 'MASSA CONGELADA DE PÃO DE QUEIJO TRAD. PEQUENO- CX 10 KG- 5UN DE 2 KG', 'CX', 67, 21965, NULL, NULL, '2026-03-15'::date, '2026-09-11'::date, '7898694173758', '17898694173755', 'inventario', NULL, 1, 2, 'U', 7, 4, 1),
  (gen_random_uuid(), 39, 'Bruno', '01.04.0022', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE REQUEIJÃO 65G - 2KG', 'PT', 280, 20926, NULL, NULL, '2026-02-23'::date, '2026-08-22'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 7, 5, 1),
  (gen_random_uuid(), 40, 'Bruno', '01.04.0021', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE GOIABADA 65G - 2KG', 'PT', 49, NULL, 'C-338', NULL, '2025-12-04'::date, '2026-06-02'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 8, 1, 1),
  (gen_random_uuid(), 41, 'Bruno', '02.03.1009', 'MASSA CONGELADA ROSCA TRANÇADA GRANDE CAIXA 4X2,5KG 10KG', 'CX', 10, 40326, NULL, NULL, '2026-03-04'::date, '2026-06-02'::date, '7898967145703', '17898967145700', 'inventario', NULL, 1, 2, 'U', 8, 2, 1),
  (gen_random_uuid(), 42, 'Bruno', '01.04.0014', 'MASSA CONGELADA DE PAO DE QUEIJO ST MARCHE 30G - CX 8KG - 20 UN DE 400G', 'CX', 16, 22396, NULL, NULL, '2026-03-24'::date, '2026-09-20'::date, '7898693580397', '17898694172598', 'inventario', NULL, 1, 2, 'U', 8, 3, 1),
  (gen_random_uuid(), 43, 'Bruno', '01.04.0008', 'PAO DE QUEIJO EMPANADO 30G - CX 10KG - 5 UN DE 2KG', 'CX', 70, 22506, NULL, NULL, '2026-03-26'::date, '2026-09-22'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 8, 4, 1),
  (gen_random_uuid(), 44, 'Bruno', '01.04.0022', 'MASSA CONGELADA DE PÃO DE QUEIJO RECHEADO DE REQUEIJÃO 65G - 2KG', 'PT', 236, 20928, NULL, NULL, '2026-02-24'::date, '2026-06-23'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 8, 5, 1),
  (gen_random_uuid(), 45, 'Bruno', '01.06.0002', 'CIABATTA MULTIGRAOS - 10UN - 1KG', 'CX', 21, 18423, NULL, NULL, '2026-01-07'::date, '2026-07-04'::date, '17898694173175', '17898694173175', 'inventario', NULL, 1, 2, 'U', 9, 2, 1),
  (gen_random_uuid(), 46, 'Bruno', '02.04.0002', 'PAO PARA HOT DOG 60G - 50 UNIDADES - 3,000 KG', 'PT', 39, 230226, NULL, NULL, '2026-02-23'::date, '2026-05-24'::date, '7898059712721', '7898059712721', 'inventario', NULL, 1, 2, 'U', 9, 3, 1),
  (gen_random_uuid(), 47, 'Bruno', '01.04.0008', 'PAO DE QUEIJO EMPANADO 30G - CX 10KG - 5 UN DE 2KG', 'CX', 70, 22564, NULL, NULL, '2026-03-27'::date, '2026-09-23'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 9, 4, 1),
  (gen_random_uuid(), 48, 'Bruno', '01.04.0008', 'PAO DE QUEIJO EMPANADO 30G - CX 10KG - 5 UN DE 2KG', 'CX', 70, 22554, NULL, NULL, '2026-03-27'::date, '2026-09-23'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 9, 5, 1),
  (gen_random_uuid(), 49, 'Bruno', '02.02.0036', 'MASSA CONGELADA DE CROISSANT SEM RECHEIO 12KG', 'CX', 7, NULL, NULL, NULL, '2026-01-30'::date, '2026-05-30'::date, NULL, '17898958973978', 'inventario', NULL, 1, 2, 'U', 10, 1, 1),
  (gen_random_uuid(), 50, 'Bruno', '02.03.1016', 'MASSA CONGELADA DE FORROZINHO COM CREME E CHOCOLATE CAIXA 4X2,5KG 10KG', 'CX', 13, NULL, NULL, NULL, '2026-01-12'::date, '2026-04-12'::date, '7898967145772', '17898967145779', 'inventario', NULL, 1, 2, 'U', 10, 2, 1),
  (gen_random_uuid(), 51, 'Bruno', '02.03.1017', 'MASSA CONGELADA DE FORROZINHO COM CREME E COCO CAIXA 4X2,5KG 10KG', 'CX', 11, NULL, NULL, NULL, '2026-01-12'::date, '2026-04-12'::date, '7898967145789', '17898967145786', 'inventario', NULL, 1, 2, 'U', 10, 2, 1),
  (gen_random_uuid(), 52, 'Bruno', '01.09.0007', 'CIABATTA HOMEBAKE TRADICIONAL 3,6KG - 12 UNIDADES 300G', 'CX', 13, 21142, NULL, NULL, '2026-02-28'::date, '2026-08-26'::date, '7898694170009', '7898694170009', 'inventario', NULL, 1, 2, 'U', 10, 3, 1),
  (gen_random_uuid(), 53, 'Bruno', '01.04.0058', 'MASSA CONGELADA DE PÃO DE QUEIJO TRAD. PEQUENO- CX 10 KG- 5UN DE 2 KG', 'CX', 66, 21088, NULL, NULL, '2026-02-26'::date, '2026-08-25'::date, '7898694173758', '17898694173755', 'inventario', NULL, 1, 2, 'U', 10, 4, 1),
  (gen_random_uuid(), 54, 'Bruno', '02.03.1010', 'MASSA CONGELADA DE PÃO DE MILHO CAIXA 4X2,5KG 10KG', 'CX', 21, 240326, NULL, NULL, '2026-03-24'::date, '2026-06-22'::date, '7898967145710', '17898967145717', 'inventario', NULL, 1, 2, 'U', 11, 2, 1),
  (gen_random_uuid(), 55, 'Bruno', '02.02.0035', 'MASSA CONGELADA DE CROISSANT DE QUEIJO E PRESUNTO FATIADO - 12KG', 'CX', 30, 230226, NULL, NULL, '2026-02-23'::date, '2026-06-23'::date, NULL, '17898663032793', 'inventario', NULL, 1, 2, 'U', 11, 3, 1),
  (gen_random_uuid(), 56, 'Bruno', '01.04.0062', 'MASSA CONGELADA DE PÃO DE QUEIJO TRADICIONAL GRANDE - CX 10 KG - 5 UN DE 2 KG', 'CX', 34, 22165, NULL, NULL, '2026-03-19'::date, '2026-09-15'::date, '7898694173765', '17898694173762', 'inventario', NULL, 1, 2, 'U', 11, 4, 1),
  (gen_random_uuid(), 57, 'Bruno', '02.02.0034', 'MASSA CONGELADA DE CROISSANT DE FRANGO COM REQUEIJAO - 12KG', 'CX', 22, 230226, NULL, NULL, '2026-02-23'::date, '2026-06-23'::date, NULL, '17898663031925', 'inventario', NULL, 1, 2, 'U', 12, 1, 1),
  (gen_random_uuid(), 58, 'Bruno', '01.04.0063', 'MASSA CONGELADA DE CHIPA QUEIJO CANASTRA 45G - 4KG CX', NULL, 70, 22333, NULL, NULL, '2026-03-20'::date, '2026-09-16'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 12, 2, 1),
  (gen_random_uuid(), 59, 'Bruno', '02.02.0044', 'RISOLES LAMINADO DE PRESUNTO E QUEIJO FRITO 150G', NULL, 84, NULL, '632', NULL, '2026-03-06'::date, '2026-09-06'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 12, 4, 1),
  (gen_random_uuid(), 60, 'Bruno', '02.02.0045', 'RISOLES DE CARNE EMPANADA COM LINHAÇA 150G - FRITO', 'CX', 84, 120626, NULL, NULL, '2026-02-12'::date, '2026-08-12'::date, '7898602745107', '17898602745104', 'inventario', NULL, 1, 2, 'U', 12, 5, 1),
  (gen_random_uuid(), 61, 'Bruno', '02.01.0007', 'MASSA CONGELADA DE PALITO 3 QUEIJOS - 2KG', 'CX', 6, 50126, NULL, NULL, '2026-01-05'::date, '2026-07-04'::date, NULL, '17898958973398', 'inventario', NULL, 1, 2, 'U', 13, 1, 1),
  (gen_random_uuid(), 62, 'Bruno', '02.03.1016', 'MASSA CONGELADA DE FORROZINHO COM CREME E CHOCOLATE CAIXA 4X2,5KG 10KG', 'CX', 2, 300126, NULL, NULL, '2026-01-30'::date, '2026-04-30'::date, '7898967145772', '17898967145779', 'inventario', NULL, 1, 2, 'U', 13, 2, 1),
  (gen_random_uuid(), 63, 'Bruno', '01.04.0062', 'MASSA CONGELADA DE PÃO DE QUEIJO TRADICIONAL GRANDE - CX 10 KG - 5 UN DE 2 KG', 'CX', 12, 21840, NULL, NULL, '2026-03-13'::date, '2026-09-09'::date, '7898694173765', '17898694173762', 'inventario', NULL, 1, 2, 'U', 13, 3, 1),
  (gen_random_uuid(), 64, 'Bruno', '02.02.0045', 'RISOLES DE CARNE EMPANADA COM LINHAÇA 150G - FRITO', 'CX', 84, 190326, NULL, NULL, '2026-03-19'::date, '2026-09-15'::date, '7898602745107', '17898602745104', 'inventario', NULL, 1, 2, 'U', 13, 5, 1),
  (gen_random_uuid(), 65, 'Bruno', '01.04.0063', 'MASSA CONGELADA DE CHIPA QUEIJO CANASTRA 45G - 4KG CX', NULL, 6, NULL, 'O-079', NULL, '2026-03-20'::date, '2026-09-16'::date, NULL, NULL, 'inventario', NULL, 1, 2, 'U', 14, 1, 1),
  (gen_random_uuid(), 66, 'Bruno', '02.03.1008', 'MASSA CONGELADA ROSCA CARACOL CAIXA 4X2,5KG 10KG', 'CX', 10, 190226, NULL, NULL, '2026-02-19'::date, '2026-05-20'::date, '7898967145697', '17898967145694', 'inventario', NULL, 1, 2, 'U', 14, 2, 1),
  (gen_random_uuid(), 67, 'Bruno', '02.03.1004', 'MASSA CONGELADA DE BISNAGUINHA CAIXA 4X2,5KG 10KG', 'CX', 18, 190226, NULL, NULL, '2026-02-19'::date, '2026-05-20'::date, '7898967145666', '17898967145663', 'inventario', NULL, 1, 2, 'U', 15, 2, 1),
  (gen_random_uuid(), 68, 'Eduardo', '01.10.0014', 'CIABATTA TRADICINAL LEVIASSA PT 220G CX 3,17 KG', 'CX', 46, 21156, NULL, NULL, '2026-02-28'::date, '2026-08-27'::date, NULL, '27898694172625', 'inventario', NULL, 1, 7, 'A', 1, 1, 1),
  (gen_random_uuid(), 69, 'Eduardo', '01.10.0014', 'CIABATTA TRADICINAL LEVIASSA PT 220G CX 3,17 KG', 'CX', 45, 20298, NULL, NULL, NULL, '2026-06-12'::date, NULL, '27898694172625', 'inventario', NULL, 1, 7, 'A', 1, 2, 1),
  (gen_random_uuid(), 70, 'Eduardo', '01.10.0013', 'MINI BAGUETE FRANCESA LEVIASSA PT 220G CX 3,17 KG', 'CX', 70, 21502, NULL, NULL, '2026-03-06'::date, '2026-07-04'::date, NULL, '27898694173509', 'inventario', NULL, 1, 7, 'A', 2, 1, 1),
  (gen_random_uuid(), 71, 'Eduardo', '01.10.0014', 'CIABATTA TRADICINAL LEVIASSA PT 220G CX 3,17 KG', 'CX', 65, NULL, '21163', NULL, '2026-02-28'::date, '2026-08-28'::date, NULL, '27898694172625', 'inventario', NULL, 1, 7, 'A', 2, 2, 1),
  (gen_random_uuid(), 72, 'Eduardo', '01.10.0013', 'MINI BAGUETE FRANCESA LEVIASSA PT 220G CX 3,17 KG', 'CX', 65, 21486, NULL, NULL, '2026-03-06'::date, '2026-07-03'::date, NULL, '27898694173509', 'inventario', NULL, 1, 7, 'A', 3, 1, 1),
  (gen_random_uuid(), 73, 'Eduardo', '01.10.0014', 'CIABATTA TRADICINAL LEVIASSA PT 220G CX 3,17 KG', 'CX', 44, NULL, NULL, NULL, NULL, '2026-08-11'::date, NULL, '27898694172625', 'inventario', NULL, 1, 7, 'A', 3, 2, 1),
  (gen_random_uuid(), 74, 'Eduardo', '01.10.0013', 'MINI BAGUETE FRANCESA LEVIASSA PT 220G CX 3,17 KG', 'CX', 70, 21041, NULL, NULL, '2026-02-26'::date, '2026-06-26'::date, NULL, '27898694173509', 'inventario', NULL, 1, 7, 'A', 4, 2, 1),
  (gen_random_uuid(), 75, 'Eduardo', '01.10.0004', 'CIABATTA COM GRAOS LEVIASSA', 'CX', 38, 21689, NULL, NULL, '2026-03-10'::date, '2026-07-07'::date, '7898694173703', '7898694173703', 'inventario', NULL, 1, 7, 'A', 5, 1, 1),
  (gen_random_uuid(), 76, 'Eduardo', '01.10.0013', 'MINI BAGUETE FRANCESA LEVIASSA PT 220G CX 3,17 KG', 'CX', 70, NULL, NULL, NULL, '2026-02-26'::date, '2026-06-25'::date, NULL, '27898694173509', 'inventario', NULL, 1, 7, 'A', 5, 2, 1),
  (gen_random_uuid(), 77, 'Eduardo', '01.10.0003', 'CIABATTA TRADICINAL LEVIASSA 220G', 'CX', 37, 20617, NULL, NULL, '2026-02-18'::date, '2026-06-18'::date, '7898694172621', '7898694172621', 'inventario', NULL, 1, 7, 'A', 6, 1, 1),
  (gen_random_uuid(), 78, 'Eduardo', '01.10.0013', 'MINI BAGUETE FRANCESA LEVIASSA PT 220G CX 3,17 KG', 'CX', 70, 21011, NULL, NULL, '2026-02-26'::date, '2026-06-25'::date, NULL, '27898694173509', 'inventario', NULL, 1, 7, 'A', 6, 2, 1);

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
