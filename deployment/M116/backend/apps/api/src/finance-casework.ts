import { BadRequestException, ConflictException, Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { FinanceExceptionCaseStatus, Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

@Controller('finance-casework')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'BRANCH_MANAGER')
export class FinanceCaseworkController {
  constructor(private readonly db: Db) {}

  // M69: case creation only for settlement evidence; source is checked for location ownership.
  @Post('cases')
  async openCase(@Body() body: { locationId: string; settlementId: string; summary: string },
    @CurrentUser() user: Principal) {
    if (!body.locationId || !body.settlementId || !body.summary?.trim() || body.summary.length > 500)
      throw new BadRequestException('locationId, settlementId and summary (max 500 chars) required');
    assertLocation(user, body.locationId);
    const settlement = await this.db.supplierPaymentSettlement.findUnique({ where: { id: body.settlementId } });
    if (!settlement || settlement.warehouseId !== body.locationId)
      throw new BadRequestException('Settlement not found in location');
    try {
      return await this.db.$transaction(async tx => {
        const created = await tx.financeExceptionCase.create({ data: {
          locationId: body.locationId, sourceType: 'SUPPLIER_SETTLEMENT', sourceId: settlement.id,
          summary: body.summary.trim(), openedById: user.id
        } });
        await tx.financeExceptionCaseEvent.create({ data: {
          caseId: created.id, actorId: user.id, action: 'OPEN', note: body.summary.trim()
        } });
        return created;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('A case already exists for this settlement');
      throw e;
    }
  }

  @Post('cases/:id/transition')
  async transition(@Param('id') id: string,
    @Body() body: { status: string; note: string },
    @CurrentUser() user: Principal) {
    if (!['INVESTIGATING', 'RESOLVED', 'DISMISSED'].includes(body.status) ||
        !body.note?.trim() || body.note.length > 1000)
      throw new BadRequestException('Valid status and note (max 1000 chars) required');
    return this.db.$transaction(async tx => {
      const existing = await tx.financeExceptionCase.findUnique({ where: { id } });
      if (!existing) throw new BadRequestException('Case not found');
      assertLocation(user, existing.locationId);
      // Optimistic concurrency: only one actor may change the observed status.
      if (existing.status === 'RESOLVED' || existing.status === 'DISMISSED')
        throw new ConflictException('Closed case cannot be changed');
      if (existing.status === 'INVESTIGATING' && body.status === 'INVESTIGATING')
        throw new ConflictException('Case is already investigating');
      const changed = await tx.financeExceptionCase.updateMany({
        where: { id, status: existing.status },
        data: {
          status: body.status as FinanceExceptionCaseStatus,
          resolutionNote: body.status === 'INVESTIGATING' ? null : body.note.trim(),
          resolvedById: body.status === 'INVESTIGATING' ? null : user.id,
        }
      });
      if (changed.count !== 1) throw new ConflictException('Case was changed by another user');
      await tx.financeExceptionCaseEvent.create({ data: {
        caseId: id, actorId: user.id, action: body.status, note: body.note.trim()
      } });
      return tx.financeExceptionCase.findUnique({ where: { id } });
    });
  }

  @Get('cases')
  async cases(@Query('locationId') locationId: string, @CurrentUser() user: Principal) {
    if (!locationId) throw new BadRequestException('locationId required');
    assertLocation(user, locationId);
    const cases = await this.db.financeExceptionCase.findMany({
      where: { locationId }, orderBy: { createdAt: 'desc' }, take: 200
    });
    const events = cases.length ? await this.db.financeExceptionCaseEvent.findMany({
      where: { caseId: { in: cases.map(x => x.id) } }, orderBy: { createdAt: 'asc' }, take: 2000
    }) : [];
    return { cases: cases.map(c => ({ ...c, events: events.filter(e => e.caseId === c.id) })),
      truncated: cases.length === 200 || events.length === 2000 };
  }

  // M70: supplier invoice statement preparation, scoped to selected invoices.
  // Supplier-wide statement needs a verified supplierId relation from the merged schema.
  @Get('invoice-register')
  async invoiceRegister(@Query('locationId') locationId: string, @CurrentUser() user: Principal) {
    if (!locationId) throw new BadRequestException('locationId required');
    assertLocation(user, locationId);
    const invoices = await this.db.supplierInvoice.findMany({
      where: { warehouseId: locationId }, orderBy: { createdAt: 'desc' }, take: 500
    });
    const settlements = invoices.length ? await this.db.supplierPaymentSettlement.findMany({
      where: { invoiceId: { in: invoices.map(i => i.id) } }, take: 5000
    }) : [];
    const reviews = settlements.length ? await this.db.supplierSettlementReview.findMany({
      where: { settlementId: { in: settlements.map(s => s.id) } }, take: 5000
    }) : [];
    const verified = new Set(reviews.filter(r => r.decision === 'VERIFIED').map(r => r.settlementId));
    return { locationId, rows: invoices.map(i => {
      const evidence = settlements.filter(s => s.invoiceId === i.id && verified.has(s.id))
        .reduce((a, s) => a.plus(s.amount), new Prisma.Decimal(0));
      return { invoiceId: i.id, invoiceNumber: i.invoiceNumber,
        invoiceDate: i.invoiceDate, invoiceAmount: i.totalAmount.toString(),
        staffVerifiedEvidence: evidence.toString(),
        remainingAgainstEvidence: i.totalAmount.minus(evidence).toString() };
    }), truncated: invoices.length === 500 || settlements.length === 5000 || reviews.length === 5000,
    warning: 'Location invoice register only, not supplier-wide statement or bank-confirmed balances.' };
  }

  // M71: computed alerts, not push/email notifications or scheduled background checks.
  @Get('alerts')
  async alerts(@Query('locationId') locationId: string, @CurrentUser() user: Principal) {
    if (!locationId) throw new BadRequestException('locationId required');
    assertLocation(user, locationId);
    const [cases, settlements, reviews] = await Promise.all([
      this.db.financeExceptionCase.findMany({
        where: { locationId, status: { in: ['OPEN', 'INVESTIGATING'] } }, take: 500
      }),
      this.db.supplierPaymentSettlement.findMany({
        where: { warehouseId: locationId }, orderBy: { createdAt: 'desc' }, take: 500
      }),
      this.db.supplierSettlementReview.findMany({ where: { warehouseId: locationId }, take: 500 })
    ]);
    const byId = new Map(reviews.map(r => [r.settlementId, r]));
    const disputed = settlements.filter(s => byId.get(s.id)?.decision === 'DISPUTED');
    const unreviewed = settlements.filter(s => !byId.has(s.id));
    return { locationId, openCaseCount: cases.length, disputedEvidenceCount: disputed.length,
      unreviewedEvidenceCount: unreviewed.length,
      truncated: cases.length === 500 || settlements.length === 500 || reviews.length === 500,
      warning: 'On-demand diagnostic counters, not proactive notifications or complete overdue-invoice detection.' };
  }
}
