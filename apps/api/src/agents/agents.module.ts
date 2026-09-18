import { Module } from '@nestjs/common';
import { ConfigFileService } from '../shared/config-file.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  controllers: [AgentsController],
  providers: [AgentsService, ConfigFileService],
})
export class AgentsModule {}
