const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const expected = {
  localSaleId: process.env.M114E_LOCAL_SALE,
  deviceId: process.env.M114E_DEVICE,
  locationId: process.env.M114E_BRANCH,
  shiftId: process.env.M114E_SHIFT,
  variantId: process.env.M114E_VARIANT
};

async function main() {
  const db = await prisma.$queryRaw`
    SELECT current_database() AS name,
           inet_server_port() AS port
  `;

  if (
    db.length !== 1 ||
    db[0].name !== 'footwear_omnichannel_test' ||
    Number(db[0].port) !== 5433
  ) {
    throw Error('SAFETY STOP: Unexpected PostgreSQL database.');
  }

  console.log('\n=== M114-E.11F FINAL AUDIT ===');
  console.log('Database:', db[0].name);

  const sales = await prisma.posSale.findMany({
    where: {
      deviceId: expected.deviceId,
      localSaleId: expected.localSaleId
    },
    include: {
      lines: true,
      tenders: true
    }
  });

  const checks = [];

  const check = (name, passed) => {
    checks.push({ name, passed });
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
  };

  check('Exactly one backend sale', sales.length === 1);

  if (sales.length !== 1) {
    process.exitCode = 1;
    return;
  }

  const sale = sales[0];

  check('Sale accepted', sale.status === 'ACCEPTED');
  check('Correct QA device', sale.deviceId === expected.deviceId);
  check('Correct QA branch', sale.locationId === expected.locationId);
  check('Correct QA shift', sale.shiftId === expected.shiftId);

  check(
    'Exactly one expected sale line',
    sale.lines.length === 1 &&
    sale.lines[0].variantId === expected.variantId &&
    sale.lines[0].quantity === 1
  );

  check('Exactly one tender', sale.tenders.length === 1);

  const movements = await prisma.stockMovement.findMany({
    where: {
      referenceId: sale.id,
      type: 'SALE'
    }
  });

  check(
    'Exactly one inventory movement',
    movements.length === 1
  );

  check(
    'Correct inventory deduction',
    movements.length === 1 &&
    movements[0].locationId === expected.locationId &&
    movements[0].variantId === expected.variantId &&
    movements[0].quantityDelta === -1
  );

  check(
    'Inventory idempotency key',
    movements.length === 1 &&
    movements[0].idempotencyKey ===
      `pos:${sale.id}:${expected.variantId}`
  );

  console.log('\nBackend sale ID:', sale.id);
  console.log('Local sale ID:', sale.localSaleId);
  console.log('Stock movements:', movements.length);

  const passed = checks.filter(c => c.passed).length;

  console.log(`\nFINAL RESULT: ${passed}/${checks.length} PASS`);

  if (passed !== checks.length) {
    process.exitCode = 1;
  }
}

main()
  .catch(error => {
    console.error('AUDIT ERROR:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
