import { Module } from '@nestjs/common';
import { SandboxController } from './sandbox.controller';
import { SandboxService } from './sandbox.service';

@Module({
  controllers: [SandboxController],
  providers: [SandboxService],
})
export class SandboxModule {}
