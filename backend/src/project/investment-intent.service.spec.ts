import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvestmentIntentService } from './investment-intent.service';
import { PathfinderService, PaymentPath, RouteAnalysis } from '../stellar/pathfinder.service';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis/redis.service';
import { CreateInvestmentIntentInputDto, InvestmentIntentStatus } from './dto/investment-intent.dto';

describe('InvestmentIntentService', () => {
  let service: InvestmentIntentService;
  let prisma: PrismaService;
  let pathfinder: PathfinderService;
  let redis: RedisService;

  const mockProject = {
    id: 'project-1',
    title: 'Test Project',
    status: 'ACTIVE',
  };

  const mockPaymentPath: PaymentPath = {
    steps: [],
    sourceAsset: { code: 'EURC', issuer: 'ISSUER_1' },
    destinationAsset: { code: 'USDC', issuer: 'ISSUER_2' },
    sourceAmount: '100',
    destinationAmount: '99',
    estimatedFeePercentage: 1.0,
    estimatedFeeAmount: '1',
    conversionRate: 0.99,
    hopCount: 1,
    executableImmediately: true,
    lastUpdated: new Date(),
  };

  const mockRouteAnalysis: RouteAnalysis = {
    bestPath: mockPaymentPath,
    alternativePaths: [
      {
        ...mockPaymentPath,
        estimatedFeePercentage: 1.5,
        estimatedFeeAmount: '1.5',
      },
    ],
    recommendation: 'Use recommended path',
    totalRoutingMetrics: {
      avgFeePercentage: 1.25,
      bestConversionRate: 0.99,
      worstConversionRate: 0.985,
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestmentIntentService,
        {
          provide: PrismaService,
          useValue: {
            project: {
              findUnique: jest.fn(),
            },
            investmentIntent: {
              findFirst: jest.fn(),
              create: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
          },
        },
        {
          provide: PathfinderService,
          useValue: {
            findBestRoutes: jest.fn(),
            findBestPath: jest.fn(),
            analyzeSwapcost: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<InvestmentIntentService>(InvestmentIntentService);
    prisma = module.get<PrismaService>(PrismaService);
    pathfinder = module.get<PathfinderService>(PathfinderService);
    redis = module.get<RedisService>(RedisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createInvestmentIntent', () => {
    it('should create a new investment intent with smart routing', async () => {
      const input: CreateInvestmentIntentInputDto = {
        projectId: 'project-1',
        investorId: 'investor-1',
        investmentAmount: 100,
        userAssetCode: 'EURC',
        projectAssetCode: 'USDC',
        projectAssetIssuer: 'ISSUER_2',
      };

      (prisma.project.findUnique as jest.Mock).mockResolvedValue(mockProject);
      (prisma.investmentIntent.findFirst as jest.Mock).mockResolvedValue(null);
      (pathfinder.findBestRoutes as jest.Mock).mockResolvedValue(mockRouteAnalysis);
      (prisma.investmentIntent.create as jest.Mock).mockResolvedValue({
        id: 'intent-1',
        ...input,
        investmentAmount: BigInt(100),
        status: InvestmentIntentStatus.PENDING,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        routeJson: mockRouteAnalysis,
      });

      const result = await service.createInvestmentIntent(input);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.status).toBe(InvestmentIntentStatus.PENDING);
      expect(result.projectId).toBe(input.projectId);
      expect(result.investorId).toBe(input.investorId);
      expect(result.proposedRoute).toBeDefined();
    });

    it('should throw NotFoundException if project does not exist', async () => {
      const input: CreateInvestmentIntentInputDto = {
        projectId: 'non-existent',
        investorId: 'investor-1',
        investmentAmount: 100,
        userAssetCode: 'EURC',
        projectAssetCode: 'USDC',
        projectAssetIssuer: 'ISSUER_2',
      };

      (prisma.project.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.createInvestmentIntent(input)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if investor has active intent', async () => {
      const input: CreateInvestmentIntentInputDto = {
        projectId: 'project-1',
        investorId: 'investor-1',
        investmentAmount: 100,
        userAssetCode: 'EURC',
        projectAssetCode: 'USDC',
        projectAssetIssuer: 'ISSUER_2',
      };

      (prisma.project.findUnique as jest.Mock).mockResolvedValue(mockProject);
      (prisma.investmentIntent.findFirst as jest.Mock).mockResolvedValue({
        id: 'existing-intent',
        status: InvestmentIntentStatus.PENDING,
      });

      await expect(service.createInvestmentIntent(input)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should cache the created intent', async () => {
      const input: CreateInvestmentIntentInputDto = {
        projectId: 'project-1',
        investorId: 'investor-1',
        investmentAmount: 100,
        userAssetCode: 'EURC',
        projectAssetCode: 'USDC',
        projectAssetIssuer: 'ISSUER_2',
      };

      (prisma.project.findUnique as jest.Mock).mockResolvedValue(mockProject);
      (prisma.investmentIntent.findFirst as jest.Mock).mockResolvedValue(null);
      (pathfinder.findBestRoutes as jest.Mock).mockResolvedValue(mockRouteAnalysis);
      (prisma.investmentIntent.create as jest.Mock).mockResolvedValue({
        id: 'intent-1',
        ...input,
        investmentAmount: BigInt(100),
        status: InvestmentIntentStatus.PENDING,
        expiresAt: new Date(Date.now() + 300000),
        createdAt: new Date(),
        routeJson: mockRouteAnalysis,
      });

      await service.createInvestmentIntent(input);

      expect(redis.set).toHaveBeenCalledWith(
        'investment_intent:intent-1',
        expect.any(Object),
        300,
      );
    });
  });

  describe('getInvestmentIntent', () => {
    it('should retrieve intent from cache', async () => {
      const cachedIntent = {
        id: 'intent-1',
        status: InvestmentIntentStatus.PENDING,
      };

      (redis.get as jest.Mock).mockResolvedValue(cachedIntent);

      const result = await service.getInvestmentIntent('intent-1');

      expect(result).toBeDefined();
      expect(redis.get).toHaveBeenCalledWith('investment_intent:intent-1');
    });

    it('should retrieve intent from database if not cached', async () => {
      (redis.get as jest.Mock).mockResolvedValue(null);
      (prisma.investmentIntent.findUnique as jest.Mock).mockResolvedValue({
        id: 'intent-1',
        status: InvestmentIntentStatus.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        routeJson: mockRouteAnalysis,
        projectId: 'project-1',
        investorId: 'investor-1',
        investmentAmount: BigInt(100),
        userAssetCode: 'EURC',
        projectAssetCode: 'USDC',
        projectAssetIssuer: 'ISSUER_2',
        createdAt: new Date(),
      });

      const result = await service.getInvestmentIntent('intent-1');

      expect(result).toBeDefined();
      expect(result.id).toBe('intent-1');
    });

    it('should throw NotFoundException for non-existent intent', async () => {
      (redis.get as jest.Mock).mockResolvedValue(null);
      (prisma.investmentIntent.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getInvestmentIntent('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should expire intent if past expiration time', async () => {
      (redis.get as jest.Mock).mockResolvedValue(null);
      (prisma.investmentIntent.findUnique as jest.Mock).mockResolvedValue({
        id: 'intent-1',
        status: InvestmentIntentStatus.PENDING,
        expiresAt: new Date(Date.now() - 1000), // Past date
        routeJson: mockRouteAnalysis,
      });
      (prisma.investmentIntent.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await expect(service.getInvestmentIntent('intent-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('approveInvestmentIntent', () => {
    it('should approve pending intent', async () => {
      (redis.get as jest.Mock).mockResolvedValue(null);
      (prisma.investmentIntent.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 'intent-1',
          status: InvestmentIntentStatus.PENDING,
          expiresAt: new Date(Date.now() + 100000),
        })
        .mockResolvedValueOnce({
          id: 'intent-1',
          status: InvestmentIntentStatus.APPROVED,
          expiresAt: new Date(Date.now() + 100000),
          executedAt: new Date(),
          routeJson: mockRouteAnalysis,
          projectId: 'project-1',
          investorId: 'investor-1',
          investmentAmount: BigInt(100),
          userAssetCode: 'EURC',
          projectAssetCode: 'USDC',
          projectAssetIssuer: 'ISSUER_2',
          createdAt: new Date(),
        });
      (prisma.investmentIntent.update as jest.Mock).mockResolvedValue({
        id: 'intent-1',
        status: InvestmentIntentStatus.APPROVED,
      });

      const result = await service.approveInvestmentIntent('intent-1');

      expect(result).toBeDefined();
      expect(result.status).toBe(InvestmentIntentStatus.APPROVED);
    });

    it('should not approve non-pending intent', async () => {
      (redis.get as jest.Mock).mockResolvedValue(null);
      (prisma.investmentIntent.findUnique as jest.Mock).mockResolvedValue({
        id: 'intent-1',
        status: InvestmentIntentStatus.REJECTED,
      });

      await expect(service.approveInvestmentIntent('intent-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('rejectInvestmentIntent', () => {
    it('should reject pending intent with reason', async () => {
      (redis.get as jest.Mock).mockResolvedValue(null);
      (prisma.investmentIntent.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 'intent-1',
          status: InvestmentIntentStatus.PENDING,
        })
        .mockResolvedValueOnce({
          id: 'intent-1',
          status: InvestmentIntentStatus.REJECTED,
          rejectionReason: 'Insufficient funds',
          routeJson: mockRouteAnalysis,
          projectId: 'project-1',
          investorId: 'investor-1',
          investmentAmount: BigInt(100),
          userAssetCode: 'EURC',
          projectAssetCode: 'USDC',
          projectAssetIssuer: 'ISSUER_2',
          createdAt: new Date(),
        });
      (prisma.investmentIntent.update as jest.Mock).mockResolvedValue({
        id: 'intent-1',
        status: InvestmentIntentStatus.REJECTED,
      });

      const result = await service.rejectInvestmentIntent(
        'intent-1',
        'Insufficient funds',
      );

      expect(result).toBeDefined();
      expect(result.status).toBe(InvestmentIntentStatus.REJECTED);
    });
  });

  describe('listInvestmentIntents', () => {
    it('should list intents with filters', async () => {
      const intents = [
        {
          id: 'intent-1',
          projectId: 'project-1',
          status: InvestmentIntentStatus.PENDING,
          routeJson: mockRouteAnalysis,
          investorId: 'investor-1',
          investmentAmount: BigInt(100),
          userAssetCode: 'EURC',
          projectAssetCode: 'USDC',
          projectAssetIssuer: 'ISSUER_2',
          createdAt: new Date(),
        },
      ];

      (prisma.investmentIntent.findMany as jest.Mock).mockResolvedValue(intents);
      (prisma.investmentIntent.count as jest.Mock).mockResolvedValue(1);

      const result = await service.listInvestmentIntents({
        projectId: 'project-1',
      });

      expect(result.intents).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('cleanupExpiredIntents', () => {
    it('should mark expired intents as expired', async () => {
      (prisma.investmentIntent.updateMany as jest.Mock).mockResolvedValue({
        count: 5,
      });

      const count = await service.cleanupExpiredIntents();

      expect(count).toBe(5);
    });
  });
});
