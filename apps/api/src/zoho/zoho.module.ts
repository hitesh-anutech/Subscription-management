import { Module } from '@nestjs/common';
import { ZohoController } from './zoho.controller';
import { ZohoService } from './zoho.service';
import { WebhookService } from './webhook.service';

@Module({
  controllers: [ZohoController],
  providers: [ZohoService, WebhookService],
  exports: [ZohoService, WebhookService],
})
export class ZohoModule {}
