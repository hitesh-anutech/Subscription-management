import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { CustomersService, SavedCustomerView } from './customers.service';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';

@Controller()
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  /** GET /api/organizations/:id/customer-columns — dynamic column catalog (standard + custom + app) */
  @Get('organizations/:id/customer-columns')
  getColumns(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getColumns(id);
  }

  /** GET /api/organizations/:id/customer-rows?q=&page=&limit= — paginated cached customer rows */
  @Get('organizations/:id/customer-rows')
  getRows(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('q') q = '',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getRows(id, {
      q,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  /** GET /api/customer-views — current user's saved views */
  @Get('customer-views')
  listViews(@CurrentUser() user: AuthUser) {
    return this.service.listViews(user.id);
  }

  /** POST /api/customer-views — create or update a saved view */
  @Post('customer-views')
  saveView(@CurrentUser() user: AuthUser, @Body() view: SavedCustomerView) {
    return this.service.saveView(user.id, view);
  }

  /** DELETE /api/customer-views/:viewId — delete a saved view */
  @Delete('customer-views/:viewId')
  deleteView(@CurrentUser() user: AuthUser, @Param('viewId') viewId: string) {
    return this.service.deleteView(user.id, viewId);
  }
}
