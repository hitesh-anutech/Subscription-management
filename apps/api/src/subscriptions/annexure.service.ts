import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import FormData from 'form-data';
import { ZohoService } from '../zoho/zoho.service';

@Injectable()
export class AnnexureService {
  private readonly logger = new Logger(AnnexureService.name);

  constructor(private readonly zoho: ZohoService) {}

  async generateAndUploadAnnexure(
    orgId: string,
    estimateId: string,
    estimateNumber: string,
    domains: { domainName: string; status: string; quantity?: number }[],
    // Optional extras — used by the combined-quote flow where several annexures can
    // hang off one estimate (a subtitle names the item/period; fileLabel keeps the
    // attachment filenames distinct). Omitted by the bulk-quote caller → unchanged.
    // `entity` lets the fresh-sales convert flow attach to an INVOICE instead.
    opts?: { subtitle?: string; fileLabel?: string; entity?: 'estimates' | 'invoices' },
  ) {
    try {
      const showQty = domains.some((d) => d.quantity != null);
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      let page = pdfDoc.addPage();
      const { width, height } = page.getSize();

      let y = height - 50;

      // Title
      page.drawText(`Technical Annexure - ${estimateNumber}`, { x: 50, y, size: 20, font: boldFont });
      y -= 28;
      if (opts?.subtitle) {
        page.drawText(opts.subtitle, { x: 50, y, size: 11, font });
        y -= 20;
      }
      page.drawText(`Total Domains: ${domains.length}`, { x: 50, y, size: 12, font });
      y -= 30;

      // Table Header
      page.drawText('Domain Name', { x: 50, y, size: 12, font: boldFont });
      if (showQty) page.drawText('Qty', { x: 360, y, size: 12, font: boldFont });
      page.drawText('Status', { x: 430, y, size: 12, font: boldFont });
      y -= 20;
      page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 1, color: rgb(0, 0, 0) });
      y -= 20;

      // Rows
      for (const d of domains) {
        if (y < 50) {
          page = pdfDoc.addPage();
          y = height - 50;
        }
        page.drawText(d.domainName, { x: 50, y, size: 10, font });
        if (showQty) page.drawText(String(d.quantity ?? ''), { x: 360, y, size: 10, font });
        page.drawText(d.status, { x: 430, y, size: 10, font });
        y -= 15;
      }

      const pdfBytes = await pdfDoc.save();
      const pdfBuffer = Buffer.from(pdfBytes);

      // Upload to Zoho
      const client = await this.zoho.clientFor(orgId);
      const formData = new FormData();
      formData.append('attachment', pdfBuffer, {
        filename: `Annexure_${estimateNumber}${opts?.fileLabel ? `_${opts.fileLabel}` : ''}.pdf`,
        contentType: 'application/pdf',
      });

      const entity = opts?.entity ?? 'estimates';
      const res = await client.post<{ code: number; message: string }>(
        `/${entity}/${estimateId}/attachment`,
        formData,
        {},
        { headers: formData.getHeaders() }
      );

      if (res.code !== 0) {
        this.logger.error(`Zoho attachment failed: ${res.message}`);
      } else {
        this.logger.log(`Uploaded Annexure for ${entity.slice(0, -1)} ${estimateId}`);
      }
    } catch (err: any) {
      this.logger.error(`Error generating annexure PDF: ${err.message}`, err.stack);
    }
  }
}
