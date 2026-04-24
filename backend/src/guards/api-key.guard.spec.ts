import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyGuard } from './api-key.guard';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma.service';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let reflector: Reflector;
  let prisma: PrismaService;

  const mockPrisma = {
    apiKey: {
      findUnique: jest.fn(),
    },
  };

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    guard = module.get<ApiKeyGuard>(ApiKeyGuard);
    reflector = module.get<Reflector>(Reflector);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    const createMockContext = (headers: Record<string, string> = {}) => ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any);

    it('should throw UnauthorizedException if API key is missing', async () => {
      const context = createMockContext();
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if API key is invalid', async () => {
      const context = createMockContext({ 'x-api-key': 'invalid-key' });
      mockPrisma.apiKey.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should return true if no scopes are required', async () => {
      const context = createMockContext({ 'x-api-key': 'valid-key' });
      mockPrisma.apiKey.findUnique.mockResolvedValue({
        key: 'valid-key',
        scopes: [],
        user: { id: 'user-1' },
      });
      mockReflector.getAllAndOverride.mockReturnValue([]);

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should return true if key has required scopes', async () => {
      const context = createMockContext({ 'x-api-key': 'valid-key' });
      mockPrisma.apiKey.findUnique.mockResolvedValue({
        key: 'valid-key',
        scopes: ['project:edit', 'investments:read'],
        user: { id: 'user-1' },
      });
      mockReflector.getAllAndOverride.mockReturnValue(['project:edit']);

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should throw ForbiddenException if key lacks required scopes', async () => {
      const context = createMockContext({ 'x-api-key': 'valid-key' });
      mockPrisma.apiKey.findUnique.mockResolvedValue({
        key: 'valid-key',
        scopes: ['investments:read'],
        user: { id: 'user-1' },
      });
      mockReflector.getAllAndOverride.mockReturnValue(['project:edit']);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });
});
