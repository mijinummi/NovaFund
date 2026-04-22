import { Module } from '@nestjs/common';
import { ShortlinkController } from './shortlink.controller';
import { ShortlinkService } from '../services/shortlink.service';
import { DatabaseModule } from '../database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ShortlinkController],
  providers: [ShortlinkService],
  exports: [ShortlinkService],
})
export class ShortlinkModule {}
