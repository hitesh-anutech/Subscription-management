import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BugReportStatus, BugReportType, BugSeverity } from '@prisma/client';

@Injectable()
export class BugReportsService {
  constructor(private readonly db: PrismaService) {}

  create(data: {
    type: BugReportType;
    severity: BugSeverity;
    details: string;
    pageUrl?: string;
    screenshots?: string[];
    reportedById?: string;
  }) {
    return this.db.bugReport.create({
      data: {
        type: data.type,
        severity: data.severity,
        details: data.details,
        pageUrl: data.pageUrl,
        screenshots: data.screenshots ?? [],
        reportedById: data.reportedById ?? null,
      },
    });
  }

  list(filters?: { status?: BugReportStatus; type?: BugReportType; severity?: BugSeverity }) {
    return this.db.bugReport.findMany({
      where: {
        ...(filters?.status   ? { status:   filters.status }   : {}),
        ...(filters?.type     ? { type:     filters.type }     : {}),
        ...(filters?.severity ? { severity: filters.severity } : {}),
      },
      include: {
        reportedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  update(id: string, data: { status?: BugReportStatus; adminNote?: string }) {
    return this.db.bugReport.update({ where: { id }, data });
  }

  delete(id: string) {
    return this.db.bugReport.delete({ where: { id } });
  }
}
