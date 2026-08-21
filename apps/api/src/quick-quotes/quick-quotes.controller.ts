import {
  Controller, Get, Post, Patch, Delete, Body, Param,
  Query, ParseUUIDPipe, HttpCode, HttpStatus, Req, ForbiddenException
} from '@nestjs/common';
import { Request } from 'express';
import { QuickQuotesService } from './quick-quotes.service';
import { CreateQuickQuoteDto, UpdateQuickQuoteDto, SendQuoteDto, AcceptQuoteDto, RejectQuoteDto } from './dto/quick-quotes.dto';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';

@Controller('quick-quotes')
export class QuickQuotesController {
  constructor(private readonly service: QuickQuotesService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('customer_type') customer_type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list({
      status,
      search,
      customer_type,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? Math.min(parseInt(limit, 10), 100) : 20,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateQuickQuoteDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQuickQuoteDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    if (user.role !== 'Admin') {
      throw new ForbiddenException('Only administrators can delete quotes');
    }
    return this.service.remove(id, user);
  }

  @Post(':id/send')
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendQuoteDto, @CurrentUser() user: AuthUser) {
    return this.service.send(id, dto, user);
  }

  /** Admin-side accept (offline-confirmed deal) — authenticated, by quote id. */
  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  acceptByAdmin(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.acceptByAdmin(id, user);
  }

  /** Undo an accidental admin accept — reverts to Sent/Draft, lead Won → Quoted. */
  @Post(':id/unaccept')
  @HttpCode(HttpStatus.OK)
  unacceptByAdmin(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.unacceptByAdmin(id, user);
  }

  // Public endpoint — no auth required
  @Public()
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  accept(@Body() dto: AcceptQuoteDto) {
    return this.service.accept(dto);
  }

  // Public endpoint — no auth required
  @Public()
  @Post('reject')
  @HttpCode(HttpStatus.OK)
  reject(@Body() dto: RejectQuoteDto) {
    return this.service.reject(dto);
  }

  // Public endpoint — no auth required
  @Public()
  @Get('public/:token')
  findByToken(@Param('token') token: string) {
    return this.service.findByToken(token);
  }
}
