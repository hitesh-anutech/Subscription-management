import { Module } from '@nestjs/common';
import { QuickQuotesController } from './quick-quotes.controller';
import { QuickQuotesService } from './quick-quotes.service';
import { EmailModule } from '../email/email.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [EmailModule, AuditLogsModule],
  controllers: [QuickQuotesController],
  providers: [QuickQuotesService],
  exports: [QuickQuotesService],
})
export class QuickQuotesModule {}
