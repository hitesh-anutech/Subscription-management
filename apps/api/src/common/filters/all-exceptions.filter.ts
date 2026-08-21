import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

/**
 * Normalizes all errors into the OpenAPI `ErrorResponse` shape:
 *   { error: { code, message, request_id } }
 *
 * Special cases:
 *   - Prisma P2002 (unique constraint) → 409 Conflict
 *   - Prisma P2025 (record not found) → 404 Not Found
 *   - HttpException → its own status
 *   - Everything else → 500
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request.headers['x-request-id'] as string) ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const obj = res as Record<string, unknown>;
        message = (obj.message as string) ?? message;
        code = (obj.code as string) ?? statusToCode(status);
      }
      code = code === 'INTERNAL_ERROR' ? statusToCode(status) : code;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const e = exception as Prisma.PrismaClientKnownRequestError;
      switch (e.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          code = 'DUPLICATE';
          message = `Unique constraint failed on: ${(e.meta as { target?: string[] })?.target?.join(', ') ?? 'unknown'}`;
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          code = 'NOT_FOUND';
          message = 'Record not found';
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          code = 'FK_VIOLATION';
          message = 'Foreign key constraint failed';
          break;
        default:
          message = e.message;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} → ${status} ${code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`[${requestId}] ${request.method} ${request.url} → ${status} ${code}: ${message}`);
    }

    response.status(status).json({
      error: {
        code,
        message,
        request_id: requestId,
      },
    });
  }
}

function statusToCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_ERROR';
    case 429:
      return 'RATE_LIMITED';
    default:
      return `HTTP_${status}`;
  }
}
