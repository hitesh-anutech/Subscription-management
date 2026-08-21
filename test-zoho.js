const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/apps/api/src/app.module');
const { PrismaService } = require('./dist/apps/api/src/prisma/prisma.service');
const { ZohoService } = require('./dist/apps/api/src/zoho/zoho.service');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const zoho = app.get(ZohoService);
  
  const quote = await prisma.quickQuote.findFirst({ where: { zohoEstimateNumber: 'INV-000036' } });
  if (!quote) { console.log('Quote not found'); process.exit(1); }
  
  const client = await zoho.clientFor(quote.targetOrganizationId);
  
  console.log('Fetching invoice email template...', quote.zohoEstimateId);
  try {
    const res = await client.get('/invoices/' + quote.zohoEstimateId + '/email');
    console.log('Email GET Response:', JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('Email GET Error:', e?.response?.data || e.message);
  }

  console.log('Fetching customer contacts...');
  try {
    const customerId = quote.zohoCustomerId || (await prisma.lead.findUnique({ where: { id: quote.leadId } }))?.convertedToZohoCustomerId;
    const res = await client.get('/contacts/' + customerId);
    console.log('Contact Persons:', JSON.stringify(res.contact?.contact_persons, null, 2));
  } catch (e) {
    console.error('Contacts GET Error:', e?.response?.data || e.message);
  }

  process.exit(0);
}

bootstrap();
