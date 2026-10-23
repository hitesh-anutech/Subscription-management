import { Module } from '@nestjs/common';
import { GoogleWorkspaceController } from './google-workspace.controller';
import { GoogleWorkspaceService } from './google-workspace.service';

@Module({
  controllers: [GoogleWorkspaceController],
  providers: [GoogleWorkspaceService],
  exports: [GoogleWorkspaceService],
})
export class GoogleWorkspaceModule {}
