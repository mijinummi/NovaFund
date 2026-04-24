import { IsOptional, IsDateString, IsBoolean, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class GenerateAuditPackageDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  includeDatabaseSnapshot?: boolean;

  @IsOptional()
  @IsBoolean()
  includeIpfsLogs?: boolean;

  @IsOptional()
  @IsBoolean()
  includeBlockchainLogs?: boolean;

  @IsOptional()
  @IsBoolean()
  includeKycHistory?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9)
  compressionLevel?: number;

  @IsOptional()
  @IsBoolean()
  encryptionEnabled?: boolean;
}

export class AuditPackageResponseDto {
  packageId: string;
  filePath: string;
  metadata: {
    id: string;
    timestamp: string;
    period: {
      startDate: string;
      endDate: string;
    };
    version: string;
    checksums: Record<string, string>;
    recordCounts: Record<string, number>;
    generatedBy: string;
  };
  downloadUrl?: string;
}

export class AuditPackageListDto {
  packages: Array<{
    packageId: string;
    timestamp: string;
    period: {
      startDate: string;
      endDate: string;
    };
    recordCounts: Record<string, number>;
    generatedBy: string;
  }>;
  total: number;
}