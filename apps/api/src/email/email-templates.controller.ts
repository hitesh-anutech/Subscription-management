import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { EmailTemplatesService } from './email-templates.service';
import { UpdateEmailTemplateDto } from './dto/email-templates.dto';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';

@Controller('settings/email/templates')
export class EmailTemplatesController {
  constructor(private readonly templates: EmailTemplatesService) {}

  /** GET /api/settings/email-templates */
  @Get()
  list() {
    return this.templates.list();
  }

  /** GET /api/settings/email-templates/:key */
  @Get(':key')
  findOne(@Param('key') key: string) {
    return this.templates.findByKey(key);
  }

  /** PATCH /api/settings/email-templates/:key */
  @Patch(':key')
  update(
    @Param('key') key: string,
    @Body() dto: UpdateEmailTemplateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.templates.update(key, dto, user.id);
  }
}
