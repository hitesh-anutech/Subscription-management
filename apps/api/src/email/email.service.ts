import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { OrgSettingsService } from '../org-settings/org-settings.service';
import { PrismaService } from '../prisma/prisma.service';
import * as nodemailer from 'nodemailer';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  organizationId?: string;
  attachments?: Array<{ filename: string; content: string; type?: string }>;
}

interface ResolvedSender {
  fromAddress: string;
  fromName: string;
  replyTo: string | null;
  smtpUser: string;
  smtpPass: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly orgSettings: OrgSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Send an email.
   * Uses per-org Gmail SMTP credentials when configured, falls back to global.
   */
  async send(opts: SendEmailOptions): Promise<void> {
    const { fromAddress, fromName, replyTo, smtpUser, smtpPass } =
      await this.resolveSender(opts.organizationId);

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: smtpUser, pass: smtpPass },
    });

    try {
      await transporter.sendMail({
        from: `"${fromName}" <${fromAddress}>`,
        to: opts.to,
        ...(replyTo ? { replyTo } : {}),
        subject: opts.subject,
        html: opts.html,
        text: opts.text ?? opts.html.replace(/<[^>]+>/g, ''),
        ...(opts.attachments?.length
          ? {
              attachments: opts.attachments.map((a) => ({
                filename: a.filename,
                content: Buffer.from(a.content, 'base64'),
                contentType: a.type ?? 'application/pdf',
              })),
            }
          : {}),
      });
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err));
    }

    this.logger.log(`Email sent to ${opts.to} from ${fromAddress}: "${opts.subject}"`);
  }

  /**
   * Resolve SMTP credentials + sender address.
   * Priority: per-org Gmail credentials → global Gmail credentials.
   */
  private async resolveSender(organizationId?: string): Promise<ResolvedSender> {
    const globalSmtpUser = await this.settings.get('email', 'smtp_user');
    const globalSmtpPass = await this.settings.get('email', 'smtp_password');
    const globalFrom     = await this.settings.get('email', 'from_address');
    const globalName     = await this.settings.get('email', 'from_name') ?? 'Excel Technologies';
    const globalReplyTo  = await this.settings.get('email', 'reply_to');

    // Per-org SMTP override
    if (organizationId) {
      const orgCreds = await this.orgSettings.getSmtpCredentials(organizationId);
      if (orgCreds) {
        const orgRow = await this.orgSettings.findByOrgId(organizationId);
        const row = orgRow as {
          emailFromAddress?: string | null;
          emailReplyTo?: string | null;
          displayName?: string | null;
          legalName?: string | null;
        } | null;
        return {
          fromAddress: row?.emailFromAddress ?? orgCreds.smtpUser,
          fromName: row?.displayName ?? row?.legalName ?? globalName,
          replyTo: row?.emailReplyTo ?? null,
          smtpUser: orgCreds.smtpUser,
          smtpPass: orgCreds.smtpPass,
        };
      }
    }

    // Global fallback
    if (!globalSmtpUser || !globalSmtpPass) {
      throw new BadRequestException(
        'SMTP not configured. Go to Settings → Email Configuration.',
      );
    }
    if (!globalFrom) {
      throw new BadRequestException(
        'From email address not configured. Set it in Settings → Email Configuration.',
      );
    }

    return {
      fromAddress: globalFrom,
      fromName: globalName,
      replyTo: globalReplyTo,
      smtpUser: globalSmtpUser,
      smtpPass: globalSmtpPass,
    };
  }

  /**
   * Send an email using a stored template.
   * Replaces {{placeholder}} tokens with values from vars.
   */
  async sendFromTemplate(
    templateKey: string,
    to: string,
    vars: Record<string, string>,
    opts?: { organizationId?: string },
  ): Promise<void> {
    const template = await this.prisma.emailTemplate.findFirst({
      where: { templateKey, organizationId: null, isActive: true },
    });
    if (!template) {
      throw new BadRequestException(
        `Email template "${templateKey}" not found or inactive`,
      );
    }

    const render = (str: string) =>
      str.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => vars[k] ?? `{{${k}}}`);

    await this.send({
      to,
      subject: render(template.subject),
      html: render(template.bodyHtml),
      text: template.bodyText ? render(template.bodyText) : undefined,
      organizationId: opts?.organizationId,
    });
  }

  async sendTestEmail(toAddress: string, organizationId?: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.send({
        to: toAddress,
        organizationId,
        subject: 'Test Email — Excel Technologies Subscription Tool',
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
            <h2 style="color:#1e293b">✅ Email Configuration Working!</h2>
            <p style="color:#475569">
              यह test email confirm करता है कि आपकी Gmail SMTP configuration सही है।
            </p>
            <p style="color:#475569">
              आप अब Subscription Management Tool से emails भेज सकते हैं।
            </p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
            <p style="color:#94a3b8;font-size:12px">
              Excel Technologies — Subscription Management Tool
            </p>
          </div>
        `,
      });
      return { success: true, message: `Test email sent to ${toAddress}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Test email failed', message);
      return { success: false, message };
    }
  }
}
