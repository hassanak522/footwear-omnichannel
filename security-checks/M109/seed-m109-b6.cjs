const { PrismaClient } = require('@prisma/client');

async function main() {
  const url = new URL(process.env.DATABASE_URL);

  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '5433' ||
    url.pathname !== '/footwear_omnichannel_test'
  ) {
    throw new Error('Test database safety check failed');
  }

  const db = new PrismaClient();

  try {
    const database = await db.$queryRaw`SELECT current_database() AS name`;

    if (database[0]?.name !== 'footwear_omnichannel_test') {
      throw new Error('Connected to unexpected database');
    }

    const location = await db.location.findUniqueOrThrow({
      where: { code: 'M109-TEST-WH' }
    });

    const product = await db.product.findUniqueOrThrow({
      where: { slug: 'm109-concurrency-test-product' }
    });

    const suffix = Date.now().toString(36);
    const sku = `M109-B6-${suffix}`;

    const result = await db.$transaction(async tx => {
      const variant = await tx.productVariant.create({
        data: {
          productId: product.id,
          sku,
          barcode: `M109-B6-BAR-${suffix}`,
          size: 'B6',
          color: 'BLACK',
          price: '1000.00'
        }
      });

      const balance = await tx.stockBalance.create({
        data: {
          locationId: location.id,
          variantId: variant.id,
          onHand: 1
        }
      });

      return {
        locationId: location.id,
        variantId: variant.id,
        sku,
        onHand: balance.onHand
      };
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
