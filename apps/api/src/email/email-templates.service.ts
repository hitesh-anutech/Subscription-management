import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateEmailTemplateDto } from './dto/email-templates.dto';

@Injectable()
export class EmailTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.emailTemplate.findMany({
      where: { organizationId: null },
      orderBy: [{ category: 'asc' }, { templateKey: 'asc' }],
      select: {
        id: true,
        templateKey: true,
        templateName: true,
        category: true,
        subject: true,
        isActive: true,
        isSystem: true,
        availablePlaceholders: true,
        updatedAt: true,
      },
    });
  }

  async findByKey(key: string) {
    const template = await this.prisma.emailTemplate.findFirst({
      where: { templateKey: key, organizationId: null },
    });
    if (!template) throw new NotFoundException(`Email template "${key}" not found`);
    return template;
  }

  async update(key: string, dto: UpdateEmailTemplateDto, updatedByUserId?: string) {
    const template = await this.findByKey(key);
    return this.prisma.emailTemplate.update({
      where: { id: template.id },
      data: {
        ...(dto.subject !== undefined && { subject: dto.subject }),
        ...(dto.bodyHtml !== undefined && { bodyHtml: dto.bodyHtml }),
        ...(dto.bodyText !== undefined && { bodyText: dto.bodyText }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(updatedByUserId && { updatedByUserId }),
      },
    });
  }

  /**
   * Replace {{placeholder}} tokens with actual values.
   * Unknown tokens are left as-is.
   */
  render(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => vars[k] ?? `{{${k}}}`);
  }
}
