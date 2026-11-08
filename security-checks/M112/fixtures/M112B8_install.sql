BEGIN;

DO $$
BEGIN
    IF current_database() <> 'footwear_omnichannel_test' THEN
        RAISE EXCEPTION 'Wrong database';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM "Location"
        WHERE code IN ('M112_POS_BRANCH_A', 'M111_TEST_BRANCH_B')
          AND type = 'BRANCH'
          AND active = true
    ) <> 2 THEN
        RAISE EXCEPTION 'Expected two active M112 test branches';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "ProductVariant"
        WHERE sku = 'M112B8-TEST-SKU'
           OR barcode = 'M112B8-TEST-BARCODE'
    ) THEN
        RAISE EXCEPTION 'M112-B8 fixture already exists';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "Category"
        WHERE slug = 'm112b8-test-category'
    ) OR EXISTS (
        SELECT 1 FROM "Product"
        WHERE slug = 'm112b8-test-product'
    ) THEN
        RAISE EXCEPTION 'M112-B8 category or product already exists';
    END IF;
END $$;

INSERT INTO "Category" (id, name, slug)
VALUES (
    :'category'::uuid,
    'M112-B8 Synthetic Category',
    'm112b8-test-category'
);

INSERT INTO "Product"
    (id, title, slug, active, "categoryId", "updatedAt")
VALUES (
    :'product'::uuid,
    'M112-B8 Synthetic Test Footwear',
    'm112b8-test-product',
    true,
    :'category'::uuid,
    CURRENT_TIMESTAMP
);

INSERT INTO "ProductVariant"
    (id, "productId", sku, barcode, size, color, price, cost, active)
VALUES (
    :'variant'::uuid,
    :'product'::uuid,
    'M112B8-TEST-SKU',
    'M112B8-TEST-BARCODE',
    '42',
    'TEST-BLACK',
    1000.00,
    600.00,
    true
);

INSERT INTO "StockBalance"
    (id, "locationId", "variantId", "onHand", "updatedAt")
SELECT
    :'balanceA'::uuid,
    id,
    :'variant'::uuid,
    20,
    CURRENT_TIMESTAMP
FROM "Location"
WHERE code = 'M112_POS_BRANCH_A';

INSERT INTO "StockBalance"
    (id, "locationId", "variantId", "onHand", "updatedAt")
SELECT
    :'balanceB'::uuid,
    id,
    :'variant'::uuid,
    20,
    CURRENT_TIMESTAMP
FROM "Location"
WHERE code = 'M111_TEST_BRANCH_B';

COMMIT;
