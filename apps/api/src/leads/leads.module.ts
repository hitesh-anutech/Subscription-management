import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { ZohoModule } from '../zoho/zoho.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [ZohoModule, AuditLogsModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
