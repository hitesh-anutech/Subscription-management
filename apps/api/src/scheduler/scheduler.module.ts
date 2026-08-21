import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ZohoModule } from '../zoho/zoho.module';
import { EmailModule } from '../email/email.module';
import { ConversionsModule } from '../conversions/conversions.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    SubscriptionsModule,
    ZohoModule,
    EmailModule,
    ConversionsModule,
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
