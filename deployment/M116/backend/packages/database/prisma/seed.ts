import { PrismaClient, LocationType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const locations = [
    { code: 'WH-KHI-01', name: 'Karachi Central Warehouse', type: LocationType.WAREHOUSE },
    { code: 'ONLINE-RS-01', name: 'Royal Step Online Store', type: LocationType.ONLINE },
    ...[1, 2, 3, 4].map((n) => ({
      code: `BR-KHI-0${n}`,
      name: `Karachi Branch ${n}`,
      type: LocationType.BRANCH,
    })),
  ];
  for (const location of locations) {
    await prisma.location.upsert({
      where: { code: location.code },
      update: { name: location.name, type: location.type },
      create: location,
    });
  }
  for (const [code, name] of [
    ['SUPER_ADMIN', 'Super Administrator'],
    ['WAREHOUSE_MANAGER', 'Warehouse Manager'],
    ['BRANCH_MANAGER', 'Branch Manager'],
    ['CASHIER', 'Cashier'],
    ['ECOMMERCE_MANAGER', 'E-Commerce Manager'],
    ['FINANCE', 'Finance'],
    ['SUPPORT', 'Customer Support'],
    ['MANAGEMENT_VIEWER', 'Management Viewer'],
  ]) {
    await prisma.role.upsert({ where: { code }, update: { name }, create: { code, name } });
  }
  console.log('Seeded 6 locations and 8 roles. No default admin password was created.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
