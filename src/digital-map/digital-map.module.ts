import { Module } from '@nestjs/common';
import { DigitalMapController } from './digital-map.controller';
import { DigitalMapValidationPipe } from './digital-map.dto';
import { DigitalMapGuard } from './digital-map.guard';
import { DigitalMapService } from './digital-map.service';
import { DigitalMapImageService } from './digital-map-image.service';

@Module({
  controllers: [DigitalMapController],
  providers: [
    DigitalMapService,
    DigitalMapImageService,
    DigitalMapGuard,
    DigitalMapValidationPipe,
  ],
})
export class DigitalMapModule {}
