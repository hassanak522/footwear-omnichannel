import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

async function main() {
  const url = process.env.DATABASE_URL;
  const password = process.env.M112_RESET_PASSWORD;

  if (!url || !password || password.length < 12) {
    throw new Error('Test DATABASE_URL and 12+ character password required');
  }

  const parsed = new URL(url);

  if (
    !['postgresql:', 'postgres:'].includes(parsed.protocol) ||
    !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
    parsed.port !== '5433' ||
    parsed.pathname !== '/footwear_omnichannel_test'
  ) {
    throw new Error('SAFETY STOP: Incorrect database connection');
  }

  const db = new PrismaClient({
    datasources: { db: { url } }
  });

  const accounts = [
    {
      email: 'm112-cashier-a@localhost.invalid',
      locationId: '0b0cc789-66ce-462b-9f94-f3ab33739975'
    },
    {
      email: 'm112-cashier-b@localhost.invalid',
      locationId: '46d6e7fe-8733-422e-83db-bd6b40bdb7d1'
    }
  ];

  try {
    const identity = await db.$queryRaw<
      Array<{ database: string }>
    >`SELECT current_database() AS database`;

    if (
      identity.length !== 1 ||
      identity[0].database !== 'footwear_omnichannel_test'
    ) {
      throw new Error('Database identity verification failed');
    }

    const users = [];

    for (const account of accounts) {
      const user = await db.user.findUnique({
        where: { email: account.email },
        include: {
          roles: { include: { role: true } },
          locations: true
        }
      });

      if (!user || user.status !== 'ACTIVE') {
        throw new Error(`Missing or inactive: ${account.email}`);
      }

      const roles = user.roles.map(r => r.role.code);
      const locations = user.locations.map(l => l.locationId);

      if (
        roles.length !== 1 ||
        roles[0] !== 'CASHIER' ||
        locations.length !== 1 ||
        locations[0] !== account.locationId
      ) {
        throw new Error(`SAFETY STOP: Unexpected permissions for ${account.email}`);
      }

      users.push(user);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await db.$transaction(async tx => {
      for (const user of users) {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash }
        });
      }
    });

    console.log('PASS: Both synthetic cashier passwords reset');
    console.log('Database: footwear_omnichannel_test');
    console.log('Accounts: Cashier A and Cashier B');
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
