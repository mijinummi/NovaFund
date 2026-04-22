import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ShortlinkService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate a unique short code
   */
  private generateShortCode(): string {
    return Math.random().toString(36).substring(2, 8);
  }

  /**
   * Create a new shortlink
   */
  async createShortlink(url: string, projectId?: string) {
    let code = this.generateShortCode();
    
    // Ensure uniqueness
    let existing = await this.prisma.shortlink.findUnique({ where: { code } });
    while (existing) {
      code = this.generateShortCode();
      existing = await this.prisma.shortlink.findUnique({ where: { code } });
    }

    return this.prisma.shortlink.create({
      data: {
        code,
        url,
        projectId,
      },
    });
  }

  /**
   * Track a click and return the original URL
   */
  async getAndTrack(code: string) {
    const shortlink = await this.prisma.shortlink.findUnique({
      where: { code },
    });

    if (!shortlink) {
      throw new NotFoundException('Shortlink not found');
    }

    // Increment click asynchronously (fire-and-forget to avoid blocking the redirect)
    this.prisma.shortlink.update({
      where: { id: shortlink.id },
      data: { clicks: { increment: 1 } },
    }).catch(err => console.error('Error tracking shortlink click:', err));

    return shortlink.url;
  }

  /**
   * Get trending projects based on shortlink clicks
   */
  async getTrendingProjects(limit: number = 10) {
    // Group by projectId and sum clicks
    const trendingShortlinks = await this.prisma.shortlink.groupBy({
      by: ['projectId'],
      _sum: {
        clicks: true,
      },
      where: {
        projectId: { not: null },
      },
      orderBy: {
        _sum: {
          clicks: 'desc',
        },
      },
      take: limit,
    });

    // Fetch the actual projects
    const projectIds = trendingShortlinks.map(s => s.projectId as string);
    const projects = await this.prisma.project.findMany({
      where: { id: { in: projectIds } },
    });

    // Map the results back to include the total clicks
    return trendingShortlinks.map(trend => {
      const project = projects.find(p => p.id === trend.projectId);
      return {
        project,
        totalClicks: trend._sum.clicks || 0,
      };
    });
  }
}
