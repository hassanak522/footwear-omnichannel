import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

@Controller('finance-audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'BRANCH_MANAGER')
export class FinanceAuditController {
  constructor(private readonly db: Db) {}

  // M51: invoice payment exposure. Read-only: no bank payment is initiated.
  @Get('invoice-exposure')
  async invoiceExposure(@Query('invoiceId') invoiceId: string, @CurrentUser() user: Principal) {
    if (!invoiceId) throw new BadRequestException('invoiceId required');
    const invoice = await this.db.supplierInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new BadRequestException('Invoice not found');
    assertLocation(user, invoice.warehouseId);
    const requests = await this.db.supplierPaymentRequest.findMany({
      where: { invoiceId }, select: { id: true, status: true, amount: true, createdAt: true }, take: 5000,
    });
    const approved = requests.filter(r => r.status === 'APPROVED').reduce((s, r) => s.plus(r.amount), new Prisma.Decimal(0));
    const pending = requests.filter(r => r.status === 'PENDING').reduce((s, r) => s.plus(r.amount), new Prisma.Decimal(0));
    const remaining = invoice.totalAmount.minus(approved).minus(pending);
    return {
      invoiceId, currency: 'PKR', invoiceAmount: invoice.totalAmount.toString(),
      approvedRequests: approved.toString(), pendingRequests: pending.toString(),
      remainingRequestCapacity: remaining.gt(0) ? remaining.toString() : '0',
      overRequested: remaining.lt(0), truncated: requests.length === 5000,
      warning: 'Approved requests are not verified payments. This is a diagnostic report, not an enforcement control.',
    };
  }

  // M52: validates staged posting line balance, without posting to a general ledger.
  @Get('posting-integrity')
  async postingIntegrity(@Query('locationId') locationId: string, @CurrentUser() user: Principal) {
    if (!locationId) throw new BadRequestException('locationId required');
    assertLocation(user, locationId);
    const batches = await this.db.financePostingBatch.findMany({
      where: { locationId }, include: { lines: true }, orderBy: { createdAt: 'desc' }, take: 1000,
    });
    const issues = batches.flatMap(b => {
      const debit = b.lines.reduce((s, l) => s.plus(l.debit), new Prisma.Decimal(0));
      const credit = b.lines.reduce((s, l) => s.plus(l.credit), new Prisma.Decimal(0));
      const invalid = b.lines.length < 2 || debit.lte(0) || !debit.eq(credit) ||
        b.lines.some(l => l.debit.lt(0) || l.credit.lt(0) || (l.debit.gt(0) && l.credit.gt(0)));
      return invalid ? [{ batchId: b.id, debit: debit.toString(), credit: credit.toString(), lines: b.lines.length }] : [];
    });
    return { locationId, checked: batches.length, issues, truncated: batches.length === 1000,
      warning: 'Structural audit only. Does not verify account codes, period closure, tax, or actual ledger posting.' };
  }

  // M53: latest manual snapshots across permitted locations; not an audited P&L.
  @Get('hq-snapshot-rollup')
  async snapshotRollup(@Query('locationIds') locationIds: string, @CurrentUser() user: Principal) {
    const ids = [...new Set((locationIds || '').split(',').map(s => s.trim()).filter(Boolean))];
    if (!ids.length || ids.length > 25 || ids.some(id => !/^[0-9a-fA-F-]{36}$/.test(id)))
      throw new BadRequestException('Provide 1–25 locationIds as comma-separated UUIDs');
    ids.forEach(id => assertLocation(user, id));
    const snapshots = await Promise.all(ids.map(async locationId => ({
      locationId, snapshot: await this.db.financeSnapshot.findFirst({
        where: { locationId }, orderBy: { snapshotDate: 'desc' },
      }),
    })));
    const fields = ['cashSales', 'receivables', 'payables', 'estimatedStockValue'] as const;
    const totals: Record<string, string> = {};
    for (const field of fields) totals[field] = snapshots.reduce(
      (sum, row) => sum.plus(row.snapshot?.[field] ?? 0), new Prisma.Decimal(0),
    ).toString();
    return { currency: 'PKR', locationCount: ids.length, withSnapshots: snapshots.filter(s => s.snapshot).length,
      totals, snapshots,
      warning: 'Each location uses its latest manually entered snapshot, possibly on different dates. Totals are not audited, period-aligned, or a P&L.' };
  }
}
