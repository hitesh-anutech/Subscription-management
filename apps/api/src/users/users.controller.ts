import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserRole } from '@prisma/client';

@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  /** GET /api/users — list all users (admin view) */
  @Get()
  list() { return this.service.list(); }

  /** POST /api/users — create a new user */
  @Post()
  createUser(
    @Body() body: { name: string; email: string; role: UserRole },
  ) {
    return this.service.createUser(body);
  }

  /** PUT /api/users/:id — update user details */
  @Put(':id')
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name?: string; role?: UserRole; isActive?: boolean },
  ) {
    return this.service.updateUser(id, body);
  }

  /** PUT /api/users/:id/org-access — set which orgs a user can see */
  @Put(':id/org-access')
  setOrgAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { org_ids: string[] },
  ) {
    return this.service.setOrgAccess(id, body.org_ids);
  }

  /** POST /api/users/:id/resend-invite — regenerate password and resend email */
  @Post(':id/resend-invite')
  resendInvite(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.resendInvite(id);
  }
}
