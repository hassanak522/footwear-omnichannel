const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function main() {
  const url = new URL(process.env.DATABASE_URL);

  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '5433' ||
    url.pathname !== '/footwear_omnichannel_test'
  ) {
    throw new Error('Refusing to modify a non-test database');
  }

  if (!process.env.M109_TEST_PASSWORD ||
      process.env.M109_TEST_PASSWORD.length < 12) {
    throw new Error('Test password missing or too short');
  }

  const db = new PrismaClient();

  try {
    const result = await db.$transaction(async tx => {
      const location = await tx.location.upsert({
        where: { code: 'M109-TEST-WH' },
        update: {},
        create: {
          code: 'M109-TEST-WH',
          name: 'M109 Synthetic Test Warehouse',
          type: 'WAREHOUSE'
        }
      });

      const category = await tx.category.upsert({
        where: { slug: 'm109-test-category' },
        update: {},
        create: {
          name: 'M109 Test Category',
          slug: 'm109-test-category'
        }
      });

      const product = await tx.product.upsert({
        where: { slug: 'm109-concurrency-test-product' },
        update: {},
        create: {
          title: 'M109 Concurrency Test Product',
          slug: 'm109-concurrency-test-product',
          categoryId: category.id
        }
      });

      const variant = await tx.productVariant.upsert({
        where: { sku: 'M109-CONCURRENCY-001' },
        update: {},
        create: {
          productId: product.id,
          sku: 'M109-CONCURRENCY-001',
          barcode: 'M109-BARCODE-001',
          size: 'TEST',
          color: 'BLACK',
          price: '1000.00'
        }
      });

      const existingBalance = await tx.stockBalance.findUnique({
        where: {
          locationId_variantId: {
            locationId: location.id,
            variantId: variant.id
          }
        }
      });

      if (existingBalance) {
        throw new Error(
          'Fixture stock already exists. Refusing to reset inventory.'
        );
      }

      await tx.stockBalance.create({
        data: {
          locationId: location.id,
          variantId: variant.id,
          onHand: 1
        }
      });

      const role = await tx.role.upsert({
        where: { code: 'WAREHOUSE_MANAGER' },
        update: {},
        create: {
          code: 'WAREHOUSE_MANAGER',
          name: 'Warehouse Manager'
        }
      });

      const email = 'm109-test@localhost.invalid';

      const existingUser = await tx.user.findUnique({
        where: { email }
      });

      if (existingUser) {
        throw new Error(
          'Test user already exists. Refusing to overwrite credentials.'
        );
      }

      const user = await tx.user.create({
        data: {
          email,
          name: 'M109 Test Warehouse Manager',
          passwordHash: await bcrypt.hash(
            process.env.M109_TEST_PASSWORD, 12
          ),
          status: 'ACTIVE'
        }
      });

      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: role.id
        }
      });

      await tx.userLocation.create({
        data: {
          userId: user.id,
          locationId: location.id
        }
      });

      return {
        database: url.pathname.slice(1),
        email,
        locationId: location.id,
        variantId: variant.id,
        sku: variant.sku,
        initialStock: 1
      };
    });

    console.log(JSON.stringify(result, null, 2));
  }
  finally {
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
