import { Module } from '@nestjs/common';
import { ConfigFileService } from '../shared/config-file.service';
import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';

@Module({
  controllers: [ToolsController],
  providers: [ToolsService, ConfigFileService],
})
export class ToolsModule {}
