import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { IntercomProvider } from './providers/intercom.provider';
import { ZendeskProvider } from './providers/zendesk.provider';
import { DatabaseModule } from '../database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [SupportController],
  providers: [SupportService, IntercomProvider, ZendeskProvider],
  exports: [SupportService],
})
export class SupportModule {}
