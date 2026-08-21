import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { OrgSettingsService } from './org-settings.service';
import { UpdateOrgSettingsDto } from './dto/update-org-settings.dto';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';

@Controller('org-settings')
export class OrgSettingsController {
  constructor(private readonly orgSettings: OrgSettingsService) {}

  /**
   * GET /api/org-settings/:orgId
   * Returns current branding settings for an org (null if never saved).
   */
  @Get(':orgId')
  async get(@Param('orgId') orgId: string) {
    const settings = await this.orgSettings.findByOrgId(orgId);
    return { settings };
  }

  /**
   * PUT /api/org-settings/:orgId
   * Create or update branding settings for an org.
   */
  @Put(':orgId')
  async update(
    @Param('orgId') orgId: string,
    @Body() dto: UpdateOrgSettingsDto,
    @CurrentUser() user: AuthUser,
  ) {
    const settings = await this.orgSettings.upsert(orgId, dto, user.id);
    return { settings, message: 'Branding saved' };
  }
}
