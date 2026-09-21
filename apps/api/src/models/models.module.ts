import { Module } from '@nestjs/common';
import { ConfigFileService } from '../shared/config-file.service';
import { ModelsAttachmentsService } from './models.attachments.service';
import { ModelsController } from './models.controller';
import { ModelsChatHistoryService } from './models.chat-history.service';
import { ModelsLangchainController } from './models.langchain.controller';
import { ModelsService } from './models.service';
import { ModelsWorkspaceService } from './models.workspace.service';

@Module({
  controllers: [ModelsController, ModelsLangchainController],
  providers: [
    ModelsService,
    ConfigFileService,
    ModelsChatHistoryService,
    ModelsAttachmentsService,
    ModelsWorkspaceService,
  ],
})
export class ModelsModule {}
