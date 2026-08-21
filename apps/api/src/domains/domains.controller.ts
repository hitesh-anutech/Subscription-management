import { Body, Controller, Get, Param, Patch, Post, Query, Res, Delete } from '@nestjs/common';
import { Response } from 'express';
import { DomainsService } from './domains.service';
import { CreateDomainDto, UpdateDomainDto } from './dto/domains.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthUser } from '../auth/decorators/current-user.decorator';

@Controller('domains')
export class DomainsController {
  constructor(private readonly service: DomainsService) {}

  @Get()
  list(
    @Query('org_id') orgId?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page')   page?: string,
    @Query('limit')  limit?: string,
  ) {
    return this.service.list({
      orgId,
      search,
      status,
      page:  page  ? Number(page)  : 1,
      limit: limit ? Number(limit) : 30,
    });
  }

  /** GET /api/domains/export-csv — static route, MUST precede @Get(':id') */
  @Get('export-csv')
  async exportCsv(
    @Res() res: Response,
    @Query('org_id') orgId?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    const csv = await this.service.exportCsv({ orgId, search, status });
    res.header('Content-Type', 'text/csv');
    res.attachment('domains_export.csv');
    return res.send(csv);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateDomainDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDomainDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Post('bulk-delete')
  bulkDelete(@Body() dto: { ids: string[] }, @CurrentUser() user: AuthUser) {
    return this.service.bulkDelete(dto.ids, user);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.delete(id, user);
  }
}
