BEGIN READ ONLY;
SELECT t.id,t.status,i."requestedQty",i."dispatchedQty",i."receivedQty",i."damagedQty" FROM "StockTransfer" t JOIN "StockTransferItem" i ON i."transferId"=t.id WHERE t.id='a95ba4e3-fc3b-4e30-918b-bb41d4098add';
SELECT "locationId","variantId","onHand","reservedOnline","reservedReplenish",quarantined FROM "StockBalance" WHERE "variantId"='4c49064f-5d8a-40ee-8a1d-b5c2ad7a0e8f' AND "locationId" IN ('87a6cd9a-ff80-41f4-869c-669b63068fce','0b0cc789-66ce-462b-9f94-f3ab33739975');
SELECT type,"quantityDelta","locationId","referenceId" FROM "StockMovement" WHERE "referenceId"='a95ba4e3-fc3b-4e30-918b-bb41d4098add' ORDER BY "createdAt";
COMMIT;
