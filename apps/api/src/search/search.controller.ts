import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  /** GET /api/search?q=... */
  @Get()
  search(@Query('q') q = '', @Query('limit') limit?: string) {
    return this.service.search(q, limit ? Number(limit) : 15);
  }
}
