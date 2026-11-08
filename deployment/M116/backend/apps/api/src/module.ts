import { FinanceCommandCenterController } from './finance-command-center';
import { FinanceCaseworkController } from './finance-casework';
import { FinanceOperationsController } from './finance-operations';
import { FinanceVerificationController } from './finance-verification';
import { FinanceReconciliationController } from './finance-reconciliation';
import { FinanceAuditReadController } from './finance-audit-read';
import { FinanceGuardrailsController } from './finance-guardrails';
import { FinanceAuditController } from './finance-audit';
import { FinanceControlsV2Controller } from './finance-controls-v2';
import { FinanceExtensionController } from './finance-extension';
import { RetailFinanceController } from './retail-finance';
import { FinanceManagementController } from './finance-management';
import { DrawerMovementController, SettlementController } from './finance-controls';
import { CashReconciliationController } from './cash-reconciliation';
import { PaymentReportsController } from './payment-reports';
import { PaymentExceptionsController } from './payment-exceptions';
import { CheckoutFoundationController } from './checkout-foundation';
import { CustomerFinanceController } from './customer-finance';
import { Module, Controller, Get, UseGuards } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Db } from './db';
import { AuthController, AuthService, JwtStrategy, RolesGuard } from './auth';
import { CatalogController } from './catalog';
import { InventoryController, InventoryService } from './inventory';
import { TransfersController, TransfersService } from './transfers';
import { PosController, PosService } from './pos';
import { HqController } from './hq';
import { OperationsController } from './operations';
import { PurchasingController, StockCountsController, RetailController, GovernanceController } from './enterprise';
import { PosReviewController } from './pos-review';
import { RetailOpsController } from './retail-ops';
import { StaffController, ReplenishmentController } from './retail-extensions';
import { StoreController, OrdersController, OnlineService } from './online';
@Controller() class HealthController { @Get('health') health(){return {status:'ok'};} }
@Module({imports:[ConfigModule.forRoot({isGlobal:true,envFilePath:['apps/api/.env','.env']}),PassportModule,JwtModule.register({secret:process.env.JWT_SECRET,signOptions:{expiresIn:'1h'}})],controllers: [FinanceCommandCenterController,FinanceCaseworkController,FinanceOperationsController,FinanceVerificationController,FinanceReconciliationController,FinanceAuditReadController,FinanceGuardrailsController,FinanceAuditController,FinanceControlsV2Controller,FinanceExtensionController,RetailFinanceController,FinanceManagementController,DrawerMovementController,SettlementController,CashReconciliationController,PaymentReportsController,PaymentExceptionsController,CheckoutFoundationController,CustomerFinanceController,RetailOpsController,HealthController,PosReviewController,AuthController,StaffController,ReplenishmentController,CatalogController,InventoryController,TransfersController,PosController,HqController,OperationsController,PurchasingController,StockCountsController,RetailController,GovernanceController,StoreController,OrdersController],providers:[Db,AuthService,JwtStrategy,RolesGuard,InventoryService,TransfersService,PosService,OnlineService]})
export class AppModule {}










