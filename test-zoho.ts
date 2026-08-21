import { NestFactory } from '@nestjs/core';
import { AppModule } from './apps/api/src/app.module';
import { PrismaService } from './apps/api/src/prisma/prisma.service';
import { ZohoService } from './apps/api/src/zoho/zoho.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const zoho = app.get(ZohoService);
  
  const quote = await prisma.quickQuote.findFirst({ where: { zohoEstimateNumber: 'INV-000036' } });
  if (!quote) { console.log('Quote not found'); process.exit(1); }
  
  const client = await zoho.clientFor(quote.targetOrganizationId);
  
  console.log('Fetching email template for invoice', quote.zohoEstimateId);
  try {
    const res = await client.get(/invoices/ + quote.zohoEstimateId + /email);
    console.log("Email GET Response:", JSON.stringify(res, null, 2));
  } catch (e) {
    console.error("Email GET Error:", e?.response?.data || e.message);
  }

  process.exit(0);
}

bootstrap();
