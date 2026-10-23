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
import { StaffController, ReplenishmentController } from './retail-extensions';
import { StoreController, OrdersController, OnlineService } from './online';
@Controller() class HealthController { @Get('health') health(){return {status:'ok'};} }
@Module({imports:[ConfigModule.forRoot({isGlobal:true,envFilePath:['apps/api/.env','.env']}),PassportModule,JwtModule.register({secret:process.env.JWT_SECRET,signOptions:{expiresIn:'1h'}})],controllers:[HealthController,AuthController,StaffController,ReplenishmentController,CatalogController,InventoryController,TransfersController,PosController,HqController,OperationsController,PurchasingController,StockCountsController,RetailController,GovernanceController,StoreController,OrdersController],providers:[Db,AuthService,JwtStrategy,RolesGuard,InventoryService,TransfersService,PosService,OnlineService]})
export class AppModule {}
