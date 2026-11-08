import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

@Controller('finance-operations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'BRANCH_MANAGER')
export class FinanceOperationsController {
  constructor(private readonly db: Db) {}

  private locationIds(raw: string, user: Principal): string[] {
    const ids = [...new Set((raw || '').split(',').map(x => x.trim()).filter(Boolean))];
    if (!ids.length || ids.length > 10 ||
        ids.some(x => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x))) {
      throw new BadRequestException('Provide 1–10 valid location UUIDs');
    }
    ids.forEach(id => assertLocation(user, id));
    return ids;
  }

  private range(from?: string, to?: string) {
    const start = new Date(from || '');
    const end = new Date(to || '');
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
        Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ||
        start > end || (end.getTime() - start.getTime()) > 93 * 86400000) {
      throw new BadRequestException('Use YYYY-MM-DD from/to, maximum 93 days');
    }
    // Exclusive upper bound, UTC calendar days.
    const until = new Date(end.getTime() + 86400000);
    return { gte: start, lt: until };
  }

  // M66: location comparison with consistent date filter; manual snapshot provenance.
  @Get('compare')
  async compare(@Query('locationIds') raw: string,
    @Query('from') from: string, @Query('to') to: string,
    @CurrentUser() user: Principal) {
    const ids = this.locationIds(raw, user);
    const dates = this.range(from, to);
    const [snapshots, requests, evidence] = await Promise.all([
      this.db.financeSnapshot.findMany({
        where: { locationId: { in: ids }, snapshotDate: dates },
        orderBy: { snapshotDate: 'desc' }, take: 2000
      }),
      this.db.supplierPaymentRequest.findMany({
        where: { warehouseId: { in: ids }, createdAt: dates },
        select: { warehouseId: true, amount: true, status: true }, take: 5000
      }),
      this.db.supplierPaymentSettlement.findMany({
        where: { warehouseId: { in: ids }, settledAt: dates },
        select: { warehouseId: true, amount: true }, take: 5000
      })
    ]);
    return {
      from, to, truncated: snapshots.length === 2000 || requests.length === 5000 || evidence.length === 5000,
      rows: ids.map(id => {
        const latest = snapshots.find(x => x.locationId === id);
        const pending = requests.filter(x => x.warehouseId === id && x.status === 'PENDING');
        const approved = requests.filter(x => x.warehouseId === id && x.status === 'APPROVED');
        const recorded = evidence.filter(x => x.warehouseId === id);
        const sum = (items: { amount: Prisma.Decimal }[]) =>
          items.reduce((a, x) => a.plus(x.amount), new Prisma.Decimal(0)).toString();
        return { locationId: id, snapshotDate: latest?.snapshotDate ?? null,
          pendingCount: pending.length, pendingAmount: sum(pending),
          approvedCount: approved.length, approvedAmount: sum(approved),
          recordedSettlementAmount: sum(recorded) };
      }),
      warning: 'Snapshot date shows most recent management entry in range. Settlement amounts are user-entered evidence, not bank-verified.'
    };
  }

  // M67: single-invoice statement, no supplier aggregation without a validated supplier relation.
  @Get('invoice-statement')
  async invoiceStatement(@Query('invoiceId') invoiceId: string,
    @CurrentUser() user: Principal) {
    if (!invoiceId) throw new BadRequestException('invoiceId required');
    const invoice = await this.db.supplierInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new BadRequestException('Invoice not found');
    assertLocation(user, invoice.warehouseId);
    const [requests, settlements] = await Promise.all([
      this.db.supplierPaymentRequest.findMany({
        where: { invoiceId }, orderBy: { createdAt: 'asc' }, take: 1000
      }),
      this.db.supplierPaymentSettlement.findMany({
        where: { invoiceId }, orderBy: { settledAt: 'asc' }, take: 1000
      })
    ]);
    const reviews = settlements.length ? await this.db.supplierSettlementReview.findMany({
      where: { settlementId: { in: settlements.map(x => x.id) } }, take: 1000
    }) : [];
    const reviewById = new Map(reviews.map(x => [x.settlementId, x]));
    const verified = settlements.filter(x => reviewById.get(x.id)?.decision === 'VERIFIED')
      .reduce((a, x) => a.plus(x.amount), new Prisma.Decimal(0));
    return {
      invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate, totalAmount: invoice.totalAmount.toString(),
        warehouseId: invoice.warehouseId },
      requests, settlements: settlements.map(x => ({ ...x, review: reviewById.get(x.id) ?? null })),
      verifiedEvidenceAmount: verified.toString(),
      remainingAgainstVerifiedEvidence: invoice.totalAmount.minus(verified).toString(),
      truncated: requests.length === 1000 || settlements.length === 1000,
      warning: 'Invoice-specific statement. Staff-reviewed evidence is not bank-confirmed settlement.'
    };
  }

  // M68: read-only exception queue derived from disputes, unreviewed evidence and over-reserved invoices.
  @Get('exceptions')
  async exceptions(@Query('locationId') locationId: string,
    @CurrentUser() user: Principal) {
    this.locationIds(locationId, user);
    const [settlements, reviews, requests] = await Promise.all([
      this.db.supplierPaymentSettlement.findMany({
        where: { warehouseId: locationId }, orderBy: { createdAt: 'desc' }, take: 500
      }),
      this.db.supplierSettlementReview.findMany({
        where: { warehouseId: locationId }, take: 500
      }),
      this.db.supplierPaymentRequest.findMany({
        where: { warehouseId: locationId, status: { in: ['PENDING', 'APPROVED'] } },
        take: 1000
      })
    ]);
    const reviewById = new Map(reviews.map(x => [x.settlementId, x]));
    const items: { type: string; id: string; invoiceId: string; amount: string; note: string }[] = [];
    for (const s of settlements) {
      const review = reviewById.get(s.id);
      if (!review || review.decision === 'DISPUTED') {
        items.push({ type: review ? 'DISPUTED_SETTLEMENT' : 'UNREVIEWED_SETTLEMENT',
          id: s.id, invoiceId: s.invoiceId, amount: s.amount.toString(),
          note: review?.note ?? 'No independent review recorded' });
      }
    }
    const invoiceIds = [...new Set(requests.map(x => x.invoiceId))];
    const invoices = invoiceIds.length ? await this.db.supplierInvoice.findMany({
      where: { id: { in: invoiceIds } }, take: 1000
    }) : [];
    for (const invoice of invoices) {
      const reserved = requests.filter(x => x.invoiceId === invoice.id)
        .reduce((a, x) => a.plus(x.amount), new Prisma.Decimal(0));
      if (reserved.gt(invoice.totalAmount)) items.push({
        type: 'OVER_RESERVED_INVOICE', id: invoice.id, invoiceId: invoice.id,
        amount: reserved.minus(invoice.totalAmount).toString(),
        note: 'Pending and approved requests exceed invoice face value'
      });
    }
    return { locationId, items, truncated: settlements.length === 500 ||
      reviews.length === 500 || requests.length === 1000,
      warning: 'Read-only exceptions; no automatic payment reversal or dispute resolution. Truncated results may miss exceptions.' };
  }
}
