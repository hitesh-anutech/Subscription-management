import { IsEmail } from 'class-validator';

export class TestEmailDto {
  @IsEmail({}, { message: 'Valid email address required' })
  to!: string;
}
