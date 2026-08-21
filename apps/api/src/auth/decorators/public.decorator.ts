import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../auth.guard';

/**
 * Mark a controller or route as public (skip AuthGuard).
 * Usage: @Public() on any controller method or class.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
