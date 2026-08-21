import { Body, Controller, Post } from '@nestjs/common';
import { EmailService } from './email.service';
import { TestEmailDto } from './dto/test-email.dto';

@Controller('settings/email')
export class EmailController {
  constructor(private readonly email: EmailService) {}

  /**
   * POST /api/settings/email/test
   * Sends a test email to verify SendGrid config.
   */
  @Post('test')
  async test(@Body() dto: TestEmailDto) {
    return this.email.sendTestEmail(dto.to);
  }
}
