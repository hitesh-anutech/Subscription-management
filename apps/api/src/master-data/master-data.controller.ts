import {
  Body, Controller, Delete, Get, Param, Patch, Post,
} from '@nestjs/common';
import { MasterDataService } from './master-data.service';
import { CreateMasterDataItemDto, UpdateMasterDataItemDto } from './dto/master-data.dto';

@Controller('master-data')
export class MasterDataController {
  constructor(private readonly service: MasterDataService) {}

  /** GET /api/master-data/:listType */
  @Get(':listType')
  list(@Param('listType') listType: string) {
    return this.service.list(listType);
  }

  /** POST /api/master-data/:listType */
  @Post(':listType')
  create(
    @Param('listType') listType: string,
    @Body() dto: CreateMasterDataItemDto,
  ) {
    return this.service.create(listType, dto);
  }

  /** PATCH /api/master-data/:listType/:id */
  @Patch(':listType/:id')
  update(
    @Param('listType') listType: string,
    @Param('id') id: string,
    @Body() dto: UpdateMasterDataItemDto,
  ) {
    return this.service.update(listType, id, dto);
  }

  /** DELETE /api/master-data/:listType/:id */
  @Delete(':listType/:id')
  remove(
    @Param('listType') listType: string,
    @Param('id') id: string,
  ) {
    return this.service.remove(listType, id);
  }
}
