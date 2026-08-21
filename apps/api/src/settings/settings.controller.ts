import {
  Body,
  Controller,
  Get,
  Param,
  Put,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /**
   * GET /api/settings/categories
   * List all setting categories.
   */
  @Get('categories')
  async listCategories() {
    const categories = await this.settings.listCategories();
    return { categories };
  }

  /**
   * GET /api/settings/:category
   * Get all settings in a category (sensitive values masked).
   */
  @Get(':category')
  async getCategory(@Param('category') category: string) {
    const settings = await this.settings.getCategory(category);
    return { category, settings };
  }

  /**
   * PUT /api/settings/:category
   * Bulk-upsert settings in a category.
   */
  @Put(':category')
  async updateCategory(
    @Param('category') category: string,
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.settings.setMany(
      category,
      dto.settings,
      user.id,
    );

    // Return fresh masked values
    const updated = await this.settings.getCategory(category);
    return { category, settings: updated, message: 'Settings saved' };
  }
}
