BEGIN READ ONLY;
SELECT 'DB_IDENTITY' AS section, current_database() AS value;
SELECT 'LOCATIONS' AS section, l.id::text AS location_id, l.code, l.type::text AS location_type, l.active::text AS active FROM "Location" l ORDER BY l.type, l.code;
SELECT 'VARIANT_STOCK' AS section, b."locationId"::text AS location_id, b."variantId"::text AS variant_id,
 b."onHand", b."reservedOnline", b."reservedReplenish", b.quarantined, b."safetyBuffer",
 (b."onHand"-b."reservedOnline"-b."reservedReplenish"-b.quarantined-b."safetyBuffer") AS available
 FROM "StockBalance" b ORDER BY b."locationId",b."variantId";
SELECT 'LOCATION_ASSIGNMENTS' AS section, ul."locationId"::text AS location_id, count(*) AS assigned_users
 FROM "UserLocation" ul GROUP BY ul."locationId" ORDER BY ul."locationId";
SELECT 'ACTIVE_VARIANTS' AS section, count(*) AS count FROM "ProductVariant" WHERE active=true;
SELECT 'TRANSFER_COUNTS' AS section, count(*) AS count FROM "StockTransfer";
COMMIT;