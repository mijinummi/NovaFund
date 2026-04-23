import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis/redis.service';
import { Project } from './dto/project.dto';
import { ProjectList } from './dto/project-list.dto';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async findById(id: string): Promise<Project> {
    const cacheKey = RedisService.getProjectKey(id);
    
    // Try to get from cache first
    const cachedProject = await this.redisService.get<Project>(cacheKey);
    if (cachedProject) {
      this.logger.debug(`Cache hit for project ${id}`);
      return cachedProject;
    }

    // If not in cache, fetch from database
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            contributions: true,
            milestones: true,
          },
        },
      },
    });

    if (!project) {
      throw new Error(`Project with ID ${id} not found`);
    }

    // Transform to match DTO
    const transformedProject = this.transformProject(project);

    // Cache the result for 5 minutes (300 seconds)
    await this.redisService.set(cacheKey, transformedProject, 300);
    
    this.logger.debug(`Cached project ${id}`);
    return transformedProject;
  }

  async findByContractId(contractId: string): Promise<Project> {
    const cacheKey = `project:contract:${contractId}`;
    
    // Try to get from cache first
    const cachedProject = await this.redisService.get<Project>(cacheKey);
    if (cachedProject) {
      this.logger.debug(`Cache hit for project by contract ID ${contractId}`);
      return cachedProject;
    }

    const project = await this.prisma.project.findUnique({
      where: { contractId },
      include: {
        _count: {
          select: {
            contributions: true,
            milestones: true,
          },
        },
      },
    });

    if (!project) {
      throw new Error(`Project with contract ID ${contractId} not found`);
    }

    const transformedProject = this.transformProject(project);

    // Cache the result for 5 minutes
    await this.redisService.set(cacheKey, transformedProject, 300);
    
    this.logger.debug(`Cached project by contract ID ${contractId}`);
    return transformedProject;
  }

  async findAll(filters: {
    skip?: number;
    take?: number;
    status?: string;
    category?: string;
    filter?: any;
  } = {}): Promise<ProjectList> {
    const cacheKey = RedisService.getProjectListKey(filters);
    
    // Try to get from cache first
    const cachedResult = await this.redisService.get<ProjectList>(cacheKey);
    if (cachedResult) {
      this.logger.debug(`Cache hit for project list with filters`);
      return cachedResult;
    }

    const { skip = 0, take = 20, status, category, filter } = filters;

    const where: any = {};
    
    // Handle legacy exact match filters
    if (status) where.status = status;
    if (category) where.category = category;

    // Handle advanced filter operators
    if (filter) {
      if (filter.title) {
        where.title = this.buildStringFilter(filter.title);
      }
      if (filter.description) {
        where.description = this.buildStringFilter(filter.description);
      }
      if (filter.category) {
        where.category = this.buildStringFilter(filter.category);
      }
      if (filter.status) {
        where.status = this.buildStringFilter(filter.status);
      }
      if (filter.creatorId) {
        where.creatorId = this.buildStringFilter(filter.creatorId);
      }
      if (filter.goal) {
        where.goal = this.buildNumberFilter(filter.goal);
      }
      if (filter.currentFunds) {
        where.currentFunds = this.buildNumberFilter(filter.currentFunds);
      }
      if (filter.deadline) {
        where.deadline = this.buildDateFilter(filter.deadline);
      }
      if (filter.createdAt) {
        where.createdAt = this.buildDateFilter(filter.createdAt);
      }
    }

    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip,
        take,
        include: {
          _count: {
            select: {
              contributions: true,
              milestones: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.project.count({ where }),
    ]);

    const transformedProjects = projects.map(project => this.transformProject(project));
    const hasNextPage = skip + take < total;

    const result: ProjectList = {
      projects: transformedProjects,
      total,
      hasNextPage,
    };

    // Cache the result for 3 minutes (180 seconds)
    await this.redisService.set(cacheKey, result, 180);
    
    this.logger.debug(`Cached project list with filters`);
    return result;
  }

  async findActiveProjects(limit?: number): Promise<Project[]> {
    const cacheKey = `projects:active:${limit || 'all'}`;
    
    // Try to get from cache first
    const cachedProjects = await this.redisService.get<Project[]>(cacheKey);
    if (cachedProjects) {
      this.logger.debug(`Cache hit for active projects`);
      return cachedProjects;
    }

    const projects = await this.prisma.project.findMany({
      where: { status: 'ACTIVE' },
      take: limit || undefined,
      include: {
        _count: {
          select: {
            contributions: true,
            milestones: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const transformedProjects = projects.map(project => this.transformProject(project));

    // Cache the result for 2 minutes (120 seconds)
    await this.redisService.set(cacheKey, transformedProjects, 120);
    
    this.logger.debug(`Cached active projects`);
    return transformedProjects;
  }

  async findByCreator(creatorId: string, limit?: number): Promise<Project[]> {
    const cacheKey = RedisService.getUserProjectsKey(creatorId) + `:${limit || 'all'}`;
    
    // Try to get from cache first
    const cachedProjects = await this.redisService.get<Project[]>(cacheKey);
    if (cachedProjects) {
      this.logger.debug(`Cache hit for creator projects`);
      return cachedProjects;
    }

    const projects = await this.prisma.project.findMany({
      where: { creatorId },
      take: limit || undefined,
      include: {
        _count: {
          select: {
            contributions: true,
            milestones: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const transformedProjects = projects.map(project => this.transformProject(project));

    // Cache the result for 3 minutes (180 seconds)
    await this.redisService.set(cacheKey, transformedProjects, 180);
    
    this.logger.debug(`Cached creator projects`);
    return transformedProjects;
  }

  /**
   * Transform database project to GraphQL DTO format
   */
  private transformProject(project: any): Project {
    return {
      id: project.id,
      contractId: project.contractId,
      creatorId: project.creatorId,
      title: project.title,
      description: project.description,
      category: project.category,
      goal: Number(project.goal),
      currentFunds: Number(project.currentFunds),
      deadline: project.deadline.toISOString(),
      ipfsHash: project.ipfsHash,
      status: project.status,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      _count: project._count,
    };
  }

  /**
   * Build Prisma filter from StringFilterInput
   */
  private buildStringFilter(filter: any): any {
    const prismaFilter: any = {};
    
    if (filter.equals !== undefined) {
      return filter.equals; // Simple equality
    }
    
    if (filter.contains !== undefined) {
      prismaFilter.contains = filter.contains;
    }
    
    if (filter.in !== undefined && Array.isArray(filter.in)) {
      prismaFilter.in = filter.in;
    }
    
    if (filter.not !== undefined) {
      prismaFilter.not = filter.not;
    }
    
    return Object.keys(prismaFilter).length > 0 ? prismaFilter : undefined;
  }

  /**
   * Build Prisma filter from FloatFilterInput or IntFilterInput
   */
  private buildNumberFilter(filter: any): any {
    const prismaFilter: any = {};
    
    if (filter.equals !== undefined) {
      return filter.equals;
    }
    
    if (filter.gt !== undefined) {
      prismaFilter.gt = filter.gt;
    }
    
    if (filter.gte !== undefined) {
      prismaFilter.gte = filter.gte;
    }
    
    if (filter.lt !== undefined) {
      prismaFilter.lt = filter.lt;
    }
    
    if (filter.lte !== undefined) {
      prismaFilter.lte = filter.lte;
    }
    
    if (filter.in !== undefined && Array.isArray(filter.in)) {
      prismaFilter.in = filter.in;
    }
    
    return Object.keys(prismaFilter).length > 0 ? prismaFilter : undefined;
  }

  /**
   * Build Prisma filter from DateTimeFilterInput
   */
  private buildDateFilter(filter: any): any {
    const prismaFilter: any = {};
    
    if (filter.equals !== undefined) {
      return new Date(filter.equals);
    }
    
    if (filter.gt !== undefined) {
      prismaFilter.gt = new Date(filter.gt);
    }
    
    if (filter.gte !== undefined) {
      prismaFilter.gte = new Date(filter.gte);
    }
    
    if (filter.lt !== undefined) {
      prismaFilter.lt = new Date(filter.lt);
    }
    
    if (filter.lte !== undefined) {
      prismaFilter.lte = new Date(filter.lte);
    }
    
    if (filter.in !== undefined && Array.isArray(filter.in)) {
      prismaFilter.in = filter.in.map((d: string) => new Date(d));
    }
    
    return Object.keys(prismaFilter).length > 0 ? prismaFilter : undefined;
  }

  /**
   * Invalidate cache for a specific project
   */
  async invalidateProjectCache(projectId: string): Promise<void> {
    await this.redisService.invalidateProjectCache(projectId);
    this.logger.log(`Invalidated cache for project ${projectId}`);
  }

  /**
   * Invalidate cache for all projects (use sparingly)
   */
  async invalidateAllProjectsCache(): Promise<void> {
    await this.redisService.delPattern('projects:*');
    await this.redisService.delPattern('project:*');
    this.logger.log('Invalidated all project cache');
  }
}
