import { Test, TestingModule } from '@nestjs/testing';
import { AuditExporterService } from './audit-exporter.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import { RedisService } from '../../redis/redis.service';

describe('AuditExporterService', () => {
  let service: AuditExporterService;
  let prismaService: PrismaService;
  let redisService: RedisService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditExporterService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config = {
                'AUDIT_ARCHIVE_DIR': './test-audit-archives',
                'AUDIT_TEMP_DIR': '/tmp/test-audits',
                'AUDIT_RETENTION_DAYS': '365',
                'AUDIT_MAX_PACKAGE_SIZE': '100MB',
              };
              return config[key];
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findMany: jest.fn(),
              count: jest.fn(),
            },
            project: {
              findMany: jest.fn(),
              count: jest.fn(),
            },
            contribution: {
              findMany: jest.fn(),
              count: jest.fn(),
            },
            auditLog: {
              findMany: jest.fn(),
              count: jest.fn(),
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            set: jest.fn(),
            get: jest.fn(),
            del: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuditExporterService>(AuditExporterService);
    prismaService = module.get<PrismaService>(PrismaService);
    redisService = module.get<RedisService>(RedisService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateAuditPackage', () => {
    it('should generate audit package with valid options', async () => {
      // Mock database responses
      jest.spyOn(prismaService.user, 'findMany').mockResolvedValue([]);
      jest.spyOn(prismaService.user, 'count').mockResolvedValue(0);
      jest.spyOn(prismaService.project, 'findMany').mockResolvedValue([]);
      jest.spyOn(prismaService.project, 'count').mockResolvedValue(0);
      jest.spyOn(prismaService.contribution, 'findMany').mockResolvedValue([]);
      jest.spyOn(prismaService.contribution, 'count').mockResolvedValue(0);
      jest.spyOn(prismaService.auditLog, 'findMany').mockResolvedValue([]);
      jest.spyOn(prismaService.auditLog, 'count').mockResolvedValue(0);

      const options = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        includeDatabaseSnapshot: true,
        includeIpfsLogs: false,
        includeBlockchainLogs: false,
        includeKycHistory: false,
      };

      const result = await service.generateAuditPackage(options, 'admin_123');

      expect(result).toBeDefined();
      expect(result.packageId).toMatch(/^audit_[a-z0-9]+_[a-z0-9]+$/);
      expect(result.metadata).toBeDefined();
      expect(result.metadata.recordCounts.database).toBe(0);
    });
  });

  describe('verifyPackageIntegrity', () => {
    it('should verify package integrity', async () => {
      // This would require creating a test package first
      // For now, just test the method exists and handles errors gracefully
      const result = await service.verifyPackageIntegrity('nonexistent-package');
      expect(result).toBe(false);
    });
  });

  describe('listAuditPackages', () => {
    it('should list audit packages', async () => {
      const packages = await service.listAuditPackages(10);
      expect(Array.isArray(packages)).toBe(true);
    });
  });
});