import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { configuration } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './crypto/crypto.module';
import { HealthModule } from './health/health.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ZohoModule } from './zoho/zoho.module';
import { AuthModule } from './auth/auth.module';
import { SettingsModule } from './settings/settings.module';
import { EmailModule } from './email/email.module';
import { OrgSettingsModule } from './org-settings/org-settings.module';
import { LeadsModule } from './leads/leads.module';
import { QuickQuotesModule } from './quick-quotes/quick-quotes.module';
import { MasterDataModule } from './master-data/master-data.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { DomainsModule } from './domains/domains.module';
import { ConversionsModule } from './conversions/conversions.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SearchModule } from './search/search.module';
import { UsersModule } from './users/users.module';
import { DocumentsModule } from './documents/documents.module';
import { CustomersModule } from './customers/customers.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { BugReportsModule } from './bug-reports/bug-reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // Walk up to monorepo root for the shared .env file
      envFilePath: [
        resolve(process.cwd(), '.env'),
        resolve(process.cwd(), '../../.env'),
      ],
    }),
    PrismaModule,
    CryptoModule,
    // AuthModule must come before feature modules (registers global APP_GUARD)
    AuthModule,
    HealthModule,
    OrganizationsModule,
    ZohoModule,
    SettingsModule,
    EmailModule,
    OrgSettingsModule,
    LeadsModule,
    QuickQuotesModule,
    MasterDataModule,
    SubscriptionsModule,
    DomainsModule,
    ConversionsModule,
    SchedulerModule,
    SearchModule,
    UsersModule,
    DocumentsModule,
    CustomersModule,
    AuditLogsModule,
    BugReportsModule,
  ],
})
export class AppModule {}
