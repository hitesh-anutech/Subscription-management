import { Controller, Get, Query } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { AuditEntityType } from '@prisma/client';

@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly service: AuditLogsService) {}

  @Get()
  getLogs(
    @Query('entityType') entityType?: AuditEntityType,
    @Query('entityId') entityId?: string,
  ) {
    return this.service.getLogs(entityType, entityId);
  }
}
