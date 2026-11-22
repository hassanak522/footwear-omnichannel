/*
 R10.3D14 - HQ SLA scheduled worker

 One execution performs one scan and exits.
 Intended for a dedicated Railway cron service.

 No email/SMS delivery occurs.
*/

const {PrismaClient} = require('@prisma/client');

const db = new PrismaClient();

const policy = {
  CRITICAL: 4,
  HIGH: 24,
  MEDIUM: 72
};

async function main() {
  if (process.env.HQ_SLA_WORKER_ENABLED !== 'true') {
    throw new Error(
      'HQ_SLA_WORKER_ENABLED must be true'
    );
  }

  const now = new Date();

  const escalations =
    await db.hqClosingEscalation.findMany({
      where: {
        status: {not: 'RESOLVED'}
      },
      select: {
        id: true,
        locationId: true,
        priority: true,
        createdAt: true
      }
    });

  const overdue = [];

  for (const escalation of escalations) {
    const hours = policy[escalation.priority];

    if (!hours) continue;

    const dueAt = new Date(
      escalation.createdAt.getTime() +
      hours * 60 * 60 * 1000
    );

    if (dueAt > now) continue;

    overdue.push({
      escalationId: escalation.id,
      locationId: escalation.locationId,
      priority: escalation.priority,
      slaHours: hours,
      dueAt,
      status: 'PENDING'
    });
  }

  const result = await db.hqClosingSlaBreach.createMany({
    data: overdue,
    skipDuplicates: true
  });

  const pending = await db.hqClosingSlaBreach.count({
    where: {status: 'PENDING'}
  });

  console.log(JSON.stringify({
    milestone: 'R10.3D14',
    scannedAt: now.toISOString(),
    escalationsScanned: escalations.length,
    overdueFound: overdue.length,
    newBreaches: result.count,
    pendingNotifications: pending,
    externalDeliveryEnabled: false
  }));
}

main()
  .catch(error => {
    console.error('SLA worker failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });