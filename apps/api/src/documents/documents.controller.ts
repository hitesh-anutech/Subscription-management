import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { DocumentsService, DocType, SavedDocumentView } from './documents.service';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';

function asDocType(v?: string): DocType {
  return v === 'estimates' ? 'estimates' : 'invoices';
}

/** Accepts 'estimate'/'estimates'/'invoice'/'invoices' → the internal kind. */
function asKind(v: string): 'estimate' | 'invoice' {
  return v === 'estimate' || v === 'estimates' ? 'estimate' : 'invoice';
}

@Controller()
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  /** GET /api/organizations/:id/document-columns?doc_type= — column catalog (standard + org custom fields) */
  @Get('organizations/:id/document-columns')
  getColumns(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('doc_type') docType?: string,
  ) {
    return this.service.getColumns(id, asDocType(docType));
  }

  /** GET /api/organizations/:id/documents — filtered + paginated live fetch from Zoho */
  @Get('organizations/:id/documents')
  fetchDocuments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('doc_type')       docType?: string,
    @Query('status')         status?: string,
    @Query('date_start')     dateStart?: string,
    @Query('date_end')       dateEnd?: string,
    @Query('customer_id')    customerId?: string,
    @Query('reference_number') referenceNumber?: string,
    @Query('business_type')  businessType?: string,
    @Query('service_expiry_from') expiryFrom?: string,
    @Query('service_expiry_to')   expiryTo?: string,
    @Query('page')           page?: string,
    @Query('per_page')       perPage?: string,
  ) {
    return this.service.fetchDocuments(
      id,
      asDocType(docType),
      { status, dateStart, dateEnd, customerId, referenceNumber, businessType, expiryFrom, expiryTo },
      page ? Number(page) : 1,
      perPage ? Number(perPage) : 50,
    );
  }

  /**
   * GET /api/organizations/:id/documents/:kind/:docId/pdf
   * Streams the Zoho estimate/invoice PDF (DB-cached; ?force=1 re-fetches,
   * ?download=1 forces an attachment download instead of inline view).
   */
  @Get('organizations/:id/documents/:kind/:docId/pdf')
  async getPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind') kind: string,
    @Param('docId') docId: string,
    @Query('download') download: string | undefined,
    @Query('force') force: string | undefined,
    @Res() res: Response,
  ) {
    const k = asKind(kind);
    const { data, number } = await this.service.getPdf(id, k, docId, {
      force: force === '1' || force === 'true',
    });
    const filename = `${(number || docId).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
    const disposition = download === '1' || download === 'true' ? 'attachment' : 'inline';
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(data.length),
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300',
    });
    res.end(data);
  }

  /** GET /api/document-views — current user's saved views */
  @Get('document-views')
  listViews(@CurrentUser() user: AuthUser) {
    return this.service.listViews(user.id);
  }

  /** POST /api/document-views — create or update a saved view */
  @Post('document-views')
  saveView(@CurrentUser() user: AuthUser, @Body() view: SavedDocumentView) {
    return this.service.saveView(user.id, view);
  }

  /** DELETE /api/document-views/:viewId — delete a saved view */
  @Delete('document-views/:viewId')
  deleteView(@CurrentUser() user: AuthUser, @Param('viewId') viewId: string) {
    return this.service.deleteView(user.id, viewId);
  }
}
