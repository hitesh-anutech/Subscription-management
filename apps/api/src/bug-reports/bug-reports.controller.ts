import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { BugReportStatus, BugReportType, BugSeverity } from '@prisma/client';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';
import { BugReportsService } from './bug-reports.service';

@Controller('bug-reports')
export class BugReportsController {
  constructor(private readonly service: BugReportsService) {}

  /** POST /api/bug-reports */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() body: {
      type: BugReportType;
      severity: BugSeverity;
      details: string;
      pageUrl?: string;
      screenshots?: string[];
    },
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create({ ...body, reportedById: user?.id });
  }

  /** GET /api/bug-reports */
  @Get()
  list(
    @Query('status')   status?:   BugReportStatus,
    @Query('type')     type?:     BugReportType,
    @Query('severity') severity?: BugSeverity,
  ) {
    return this.service.list({ status, type, severity });
  }

  /** PATCH /api/bug-reports/:id */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status?: BugReportStatus; adminNote?: string },
  ) {
    return this.service.update(id, body);
  }

  /** DELETE /api/bug-reports/:id */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.delete(id);
  }
}
