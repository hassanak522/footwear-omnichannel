BEGIN READ ONLY;
SELECT 'QA_DATABASE' AS check_name, current_database() AS value;
SELECT l.id AS location_id,l.name AS location_name,l.type,l.active,
       COUNT(DISTINCT d.id) AS registered_devices,
       COUNT(DISTINCT s.id) FILTER (WHERE s.status='OPEN') AS open_shifts
FROM "Location" l
LEFT JOIN "PosDevice" d ON d."locationId"=l.id
LEFT JOIN "PosShift" s ON s."deviceId"=d.id
WHERE l.type='BRANCH'
GROUP BY l.id,l.name,l.type,l.active
ORDER BY l.name;
SELECT b."locationId" AS location_id,b."variantId" AS variant_id,
       b."onHand" AS on_hand,b."reservedOnline" AS reserved_online,
       b."reservedReplenish" AS reserved_replenish,b.quarantined,b."safetyBuffer" AS safety_buffer,
       (b."onHand"-b."reservedOnline"-b."reservedReplenish"-b.quarantined-b."safetyBuffer") AS available
FROM "StockBalance" b JOIN "Location" l ON l.id=b."locationId"
WHERE l.type='BRANCH' AND l.active=true
ORDER BY available DESC,b."locationId",b."variantId" LIMIT 20;
COMMIT;
