import { Module } from '@nestjs/common';
import { AuditExporterService } from './services/audit-exporter.service';
import { AuditController } from './controllers/audit.controller';

@Module({
  imports: [],
  controllers: [AuditController],
  providers: [AuditExporterService],
  exports: [AuditExporterService],
})
export class AdminModule {}