import { Module } from '@nestjs/common';
import { VisionService } from './vision.service';
import { LocalOcrService } from './local-ocr.service';

@Module({
  providers: [VisionService, LocalOcrService],
  exports: [VisionService, LocalOcrService],
})
export class AIModule {}
