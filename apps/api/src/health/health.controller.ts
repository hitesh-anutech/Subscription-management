import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    const checks: Record<string, { ok: boolean; latency_ms?: number; error?: string }> = {};

    // DB ping
    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { ok: true, latency_ms: Date.now() - dbStart };
    } catch (err) {
      checks.database = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const ok = Object.values(checks).every((c) => c.ok);

    return {
      status: ok ? 'healthy' : 'degraded',
      version: process.env.npm_package_version ?? '1.0.0',
      uptime_seconds: Math.floor(process.uptime()),
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  /** GET /api/health/system — detailed system health (authenticated) */
  @Get('system')
  async systemHealth() {
    const [
      orgCount, leadCount, quoteCount, templateCount, masterDataCount, userCount,
      orgs,
      emailSetting,
    ] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.lead.count(),
      this.prisma.quickQuote.count(),
      this.prisma.emailTemplate.count(),
      this.prisma.masterDataList.count(),
      this.prisma.user.count(),
      this.prisma.organization.findMany({
        select: {
          id: true,
          name: true,
          zohoOrgId: true,
          connectionStatus: true,
          lastSyncAt: true,
          isActive: true,
          tokenExpiresAt: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.appSettings.findFirst({
        where: { category: 'email', settingKey: 'smtp_password' },
        select: { isSensitive: true, settingValue: true },
      }),
    ]);

    const emailConfigured = emailSetting?.settingValue != null
      && String(emailSetting.settingValue).length > 0;

    return {
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      version: process.env.npm_package_version ?? '1.0.0',
      node_env: process.env.NODE_ENV ?? 'development',
      database: {
        status: 'connected',
        counts: {
          organizations: orgCount,
          leads: leadCount,
          quick_quotes: quoteCount,
          email_templates: templateCount,
          master_data_items: masterDataCount,
          users: userCount,
        },
      },
      zoho_connections: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        zohoOrgId: o.zohoOrgId,
        connectionStatus: o.connectionStatus,
        isActive: o.isActive,
        lastSyncAt: o.lastSyncAt,
        tokenExpiresAt: o.tokenExpiresAt,
        tokenExpired: o.tokenExpiresAt ? o.tokenExpiresAt < new Date() : null,
      })),
      integrations: {
        email: emailConfigured ? 'configured' : 'not_configured',
      },
    };
  }
}
