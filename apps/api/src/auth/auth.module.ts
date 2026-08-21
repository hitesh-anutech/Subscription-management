import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';

/**
 * Global AuthModule — registers the AuthGuard for ALL routes.
 * Mark public routes with @Public() decorator.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    // Register guard globally so all routes are protected by default
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
