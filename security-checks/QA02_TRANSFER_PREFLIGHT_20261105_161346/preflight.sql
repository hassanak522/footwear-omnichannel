BEGIN READ ONLY;
SELECT 'DATABASE_IDENTITY' AS section, jsonb_build_object('database',current_database(),'user',current_user) AS data;
SELECT 'LOCATIONS' AS section, to_jsonb(l) AS data FROM "Location" l ORDER BY l.id;
SELECT 'USER_LOCATION_ASSIGNMENT_COUNTS' AS section, jsonb_build_object('locationId', "locationId",'count',count(*)) AS data FROM "UserLocation" GROUP BY "locationId" ORDER BY "locationId";
SELECT 'PRODUCT_VARIANTS' AS section, jsonb_build_object('id',v.id) AS data FROM "ProductVariant" v ORDER BY v.id LIMIT 20;
SELECT 'TRANSFER_TABLE_COLUMNS' AS section, jsonb_build_object('table',table_name,'column',column_name,'type',data_type,'nullable',is_nullable) AS data FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('StockTransfer','StockTransferItem','StockBalance','StockMovement') ORDER BY table_name,ordinal_position;
SELECT 'RETAIL_TABLE_COUNTS' AS section, jsonb_build_object('table',c.relname,'estimated_rows',c.reltuples) AS data FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('Location','StockTransfer','StockTransferItem','StockBalance','StockMovement');
COMMIT;
