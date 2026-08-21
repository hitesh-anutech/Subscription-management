import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { AnnexureService } from './annexure.service';
import { ZohoModule } from '../zoho/zoho.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [ZohoModule, AuditLogsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, AnnexureService],
  exports: [SubscriptionsService, AnnexureService],
})
export class SubscriptionsModule {}
