import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditEntityType, AuditAction } from '@prisma/client';

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async logAction(params: {
    entityType: AuditEntityType;
    entityId: string;
    action: AuditAction;
    changeSummary: string;
    oldValue?: any;
    newValue?: any;
    userId?: string;
    userEmailSnapshot?: string;
  }) {
    try {
      await this.prisma.settingsAuditLog.create({
        data: {
          entityType: params.entityType,
          entityId: params.entityId,
          action: params.action,
          changeSummary: params.changeSummary,
          oldValue: params.oldValue ?? undefined,
          newValue: params.newValue ?? undefined,
          userId: params.userId ?? undefined,
          userEmailSnapshot: params.userEmailSnapshot ?? undefined,
        },
      });
      this.logger.log(`Audit log created: ${params.entityType} ${params.entityId} - ${params.changeSummary}`);
    } catch (err) {
      this.logger.error(`Failed to create audit log: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getLogs(entityType?: AuditEntityType, entityId?: string) {
    const whereClause: any = {};
    if (entityType) whereClause.entityType = entityType;
    if (entityId) whereClause.entityId = entityId;

    return this.prisma.settingsAuditLog.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 200, // Limit to 200 for now
    });
  }
}
