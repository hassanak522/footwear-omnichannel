import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

async function main() {
  const url = process.env.DATABASE_URL;
  const password = process.env.M112_RESET_PASSWORD;
  const email = 'm112-manager-a@localhost.invalid';

  if (!url || !password || password.length < 12) {
    throw new Error('Test DATABASE_URL and a 12+ character password are required');
  }

  const parsed = new URL(url);

  if (
    parsed.protocol !== 'postgresql:' &&
    parsed.protocol !== 'postgres:'
  ) {
    throw new Error('PostgreSQL connection required');
  }

  if (
    parsed.hostname !== '127.0.0.1' &&
    parsed.hostname !== 'localhost'
  ) {
    throw new Error('Only local PostgreSQL is allowed');
  }

  if (
    parsed.port !== '5433' ||
    parsed.pathname !== '/footwear_omnichannel_test'
  ) {
    throw new Error('SAFETY STOP: Incorrect database');
  }

  const db = new PrismaClient({
    datasources: {
      db: { url }
    }
  });

  try {
    const database = await db.$queryRawUnsafe<
      Array<{ current_database: string }>
    >('SELECT current_database()');

    if (
      database.length !== 1 ||
      database[0].current_database !== 'footwear_omnichannel_test'
    ) {
      throw new Error('Database identity verification failed');
    }

    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true, status: true }
    });

    if (!user) {
      throw new Error('M112 Manager A test user not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new Error('M112 Manager A account is not active');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash }
    });

    console.log('PASS: M112 Manager A test password reset');
    console.log('Database: footwear_omnichannel_test');
    console.log('User:', email);
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
