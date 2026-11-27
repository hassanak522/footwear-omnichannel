import { Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';

// R10_3D24_48D3G4D4_REFUND_ENTITLEMENT

export async function refundCorrectionEntitlement(
  tx: Prisma.TransactionClient,
  returnId: string,
) {
  const attempts = await tx.posRefundAttempt.findMany({
    where: { returnId },
    select: {
      id: true,
      amount: true,
      status: true,
      settlementId: true,
    },
  });

  const corrections =
    await tx.posFinancialCorrection.findMany({
      where: {
        refundAttemptId: {
          in: attempts.map(a => a.id),
        },
        status: { in: ['PENDING', 'APPROVED'] },
      },
    });

  const events =
    await tx.posFinancialCorrectionEconomicEvent.findMany({
      where: {
        correctionId: {
          in: corrections.map(c => c.id),
        },
      },
    });

  let historical = new Prisma.Decimal(0);

  for (const event of events) {
    const correction = corrections.find(
      c => c.id === event.correctionId,
    );

    const attempt = attempts.find(
      a => a.id === correction?.refundAttemptId,
    );

    if (
      !correction ||
      !attempt ||
      correction.status !== 'APPROVED' ||
      correction.correctionType !==
        'CONTRADICTORY_REFUND_PAYMENT' ||
      attempt.status !== 'RESOLVED_NO_PAYMENT' ||
      attempt.settlementId !== null ||
      event.direction !== 'OUTFLOW' ||
      event.locationId !== correction.locationId ||
      event.originalShiftId !==
        correction.originalShiftId ||
      !event.amount.eq(correction.amount) ||
      !event.amount.eq(attempt.amount) ||
      event.amount.lte(0) ||
      event.cashAmount.lt(0) ||
      event.cardAmount.lt(0) ||
      event.otherAmount.lt(0) ||
      !event.cashAmount
        .plus(event.cardAmount)
        .plus(event.otherAmount)
        .eq(event.amount)
    ) {
      throw new ConflictException(
        'Historical refund evidence requires reconciliation',
      );
    }

    const execution =
      await tx.posFinancialCorrectionExecution.findUnique({
        where: { id: event.executionId },
      });

    if (
      !execution ||
      execution.correctionId !== correction.id ||
      !execution.amount.eq(event.amount)
    ) {
      throw new ConflictException(
        'Historical refund execution identity mismatch',
      );
    }

    historical = historical.plus(event.amount);
  }

  const historicalCents = historical.mul(100).toNumber();

  if (
    !Number.isSafeInteger(historicalCents) ||
    historicalCents < 0
  ) {
    throw new ConflictException(
      'Historical refund amount exceeds supported precision',
    );
  }

  const unresolvedAttempts = attempts.filter(
    a =>
      a.status !== 'ACCEPTED' &&
      a.status !== 'RESOLVED_NO_PAYMENT',
  );

  return {
    historicalCents,
    historicalPaymentCount: events.length,
    correctionHold: corrections.length > 0,
    activeCorrectionCount: corrections.length,
    unresolvedAttemptCount: unresolvedAttempts.length,
    unresolvedAttemptIds: unresolvedAttempts.map(a => a.id),
  };
}


// R10_3D24_48D3G4D4I2_AUTHORITATIVE_REPORTING

export async function authoritativeRefundPosition(
  tx: Prisma.TransactionClient,
  returnId: string,
) {
  const ret = await tx.posReturn.findUnique({
    where: { id: returnId },
    include: {
      lines: true,
      settlements: true,
      exchange: true,
    },
  });

  if (!ret || ret.status !== 'APPROVED') {
    throw new ConflictException(
      'Approved return required for financial reporting',
    );
  }

  const cents = (value: Prisma.Decimal): number => {
    const result = value.mul(100).toNumber();

    if (
      !Number.isSafeInteger(result) ||
      result < 0
    ) {
      throw new ConflictException(
        'Invalid refund monetary precision',
      );
    }

    return result;
  };

  const sum = (values: number[]): number => {
    const result = values.reduce(
      (total, value) => total + value,
      0,
    );

    if (
      !Number.isSafeInteger(result) ||
      result < 0
    ) {
      throw new ConflictException(
        'Invalid refund financial total',
      );
    }

    return result;
  };

  const format = (value: number) =>
    (value / 100).toFixed(2);

  const grossCents = sum(
    ret.lines.map(line => cents(line.refundAmount)),
  );

  let exchangeCreditCents = 0;

  if (ret.exchange) {
    const replacement =
      await tx.posSale.findUnique({
        where: {
          id: ret.exchange.replacementSaleId,
        },
        include: { tenders: true },
      });

    if (
      !replacement ||
      replacement.status !== 'ACCEPTED' ||
      replacement.locationId !== ret.locationId
    ) {
      throw new ConflictException(
        'Exchange replacement requires reconciliation',
      );
    }

    exchangeCreditCents = sum(
      replacement.tenders
        .filter(t => t.type === 'EXCHANGE_CREDIT')
        .map(t => cents(t.amount)),
    );
  }

  if (exchangeCreditCents > grossCents) {
    throw new ConflictException(
      'Exchange credit exceeds approved return value',
    );
  }

  const ordinaryCents = sum(
    ret.settlements.map(settlement => {
      if (
        !['CASH', 'CARD', 'OTHER']
          .includes(settlement.method) ||
        settlement.amount.lte(0)
      ) {
        throw new ConflictException(
          'Invalid ordinary refund settlement',
        );
      }

      return cents(settlement.amount);
    }),
  );

  const correction =
    await refundCorrectionEntitlement(tx, ret.id);

  const legacy = await tx.refundRecord.findUnique({
    where: { returnId: ret.id },
  });

  if (
    legacy &&
    legacy.locationId !== ret.locationId
  ) {
    throw new ConflictException(
      'Legacy refund location mismatch',
    );
  }

  const legacyCents =
    legacy?.status === 'PAID'
      ? cents(legacy.amount)
      : 0;

  const historicalCents =
    correction.historicalCents;

  const dueCents =
    grossCents - exchangeCreditCents;

  const recordedPaymentCents = sum([
    ordinaryCents,
    historicalCents,
    legacyCents,
  ]);

  const outstandingCents = Math.max(
    0,
    dueCents - recordedPaymentCents,
  );

  const overpaymentCents = Math.max(
    0,
    recordedPaymentCents - dueCents,
  );

  const blockers: string[] = [];

  if (correction.correctionHold) {
    blockers.push('FINANCIAL_CORRECTION_HOLD');
  }

  if (correction.unresolvedAttemptCount > 0) {
    blockers.push('UNRESOLVED_REFUND_ATTEMPT');
  }

  if (legacy) {
    blockers.push('LEGACY_REFUND_WORKFLOW');
  }

  if (overpaymentCents > 0) {
    blockers.push('REFUND_OVERPAYMENT');
  }

  if (
    legacyCents > 0 &&
    (ordinaryCents > 0 || historicalCents > 0)
  ) {
    blockers.push(
      'CROSS_WORKFLOW_PAYMENT_RECONCILIATION',
    );
  }

  if (outstandingCents === 0) {
    blockers.push('NO_OUTSTANDING_ENTITLEMENT');
  }

  const settlementStatus =
    overpaymentCents > 0
      ? 'OVERPAID'
      : outstandingCents === 0
        ? 'SETTLED'
        : recordedPaymentCents > 0
          ? 'PARTIALLY_SETTLED'
          : 'UNSETTLED';

  return {
    returnId: ret.id,
    locationId: ret.locationId,
    currency: 'PKR',

    originalReturnValue: format(grossCents),
    exchangeCredit: format(exchangeCreditCents),

    refundDue: format(dueCents),

    ordinaryRefundPaid: format(ordinaryCents),
    historicalRefundPaid: format(historicalCents),
    legacyRefundPaid: format(legacyCents),

    refundSettled: format(recordedPaymentCents),
    refundOutstanding: format(outstandingCents),
    refundOverpayment: format(overpaymentCents),

    settlementStatus,

    historicalPaymentCount:
      correction.historicalPaymentCount,

    activeCorrectionCount:
      correction.activeCorrectionCount,

    unresolvedAttemptCount:
      correction.unresolvedAttemptCount,

    financialCorrectionHold:
      correction.correctionHold,

    legacyRefundStatus:
      legacy?.status ?? null,

    blockers,

    refundExecutionBlocked:
      blockers.length > 0,

    // A reporting result never authorizes payment.
    paymentExecutionAuthorized: false,

    requiresReconciliation:
      overpaymentCents > 0 ||
      correction.correctionHold ||
      correction.unresolvedAttemptCount > 0 ||
      (
        legacyCents > 0 &&
        (ordinaryCents > 0 || historicalCents > 0)
      ),

    calculatedAt: new Date(),
  };
}
