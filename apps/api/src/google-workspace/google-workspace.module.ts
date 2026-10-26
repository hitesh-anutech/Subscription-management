import { Module } from '@nestjs/common';
import { GoogleWorkspaceController } from './google-workspace.controller';
import { GoogleWorkspaceService } from './google-workspace.service';
import { GoogleResellerSubsService } from './google-reseller-subs.service';

@Module({
  controllers: [GoogleWorkspaceController],
  providers: [GoogleWorkspaceService, GoogleResellerSubsService],
  exports: [GoogleWorkspaceService, GoogleResellerSubsService],
})
export class GoogleWorkspaceModule {}
