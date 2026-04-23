import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../prisma.service';
import * as fs from 'fs';
import * as path from 'path';

export const GEO_RESTRICTED_KEY = 'geo_restricted';

/**
 * GeoIP Guard for regional investment restrictions
 * 
 * This guard checks the user's IP address against project-specific
 * restricted regions using MaxMind GeoIP2 database.
 * 
 * Usage:
 * - Add @UseGuards(GeoGuard) to routes that need geo-checking
 * - Configure GEOLITE2_DB_PATH in .env for MaxMind database
 * - Projects can specify restrictedRegions array (ISO country codes)
 */
@Injectable()
export class GeoGuard implements CanActivate {
  private readonly logger = new Logger(GeoGuard.name);
  private geoLiteInitialized = false;
  private geoLiteDb: any = null;

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {
    this.initializeGeoLite();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isGeoRestricted = this.reflector.getAllAndOverride<boolean>(
      GEO_RESTRICTED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!isGeoRestricted) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const projectId = this.extractProjectId(request);

    if (!projectId) {
      this.logger.warn('Project ID not found in request');
      return true; // Allow if we can't determine the project
    }

    // Get client IP
    const clientIp = this.getClientIp(request);
    if (!clientIp) {
      this.logger.warn('Unable to determine client IP');
      return true;
    }

    // Get project's restricted regions
    const restrictedRegions = await this.getProjectRestrictedRegions(projectId);

    if (!restrictedRegions || restrictedRegions.length === 0) {
      return true; // No restrictions for this project
    }

    // If GeoLite2 is not initialized, skip the check (graceful degradation)
    if (!this.geoLiteInitialized || !this.geoLiteDb) {
      this.logger.warn('GeoLite2 database not available, skipping geo check');
      return true;
    }

    // Check if user's country is in restricted regions
    const userCountry = await this.lookupCountry(clientIp);

    if (!userCountry) {
      this.logger.warn(`Unable to lookup country for IP: ${clientIp}`);
      return true;
    }

    if (restrictedRegions.includes(userCountry)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: `Investments from ${userCountry} are not allowed for this project due to regulatory restrictions.`,
        country: userCountry,
      });
    }

    return true;
  }

  private async initializeGeoLite(): Promise<void> {
    try {
      // Check if we have MaxMind GeoLite2 installed
      const maxmindPath = path.join(process.cwd(), 'node_modules', '@maxmind', 'geoip2-node');
      
      if (!fs.existsSync(maxmindPath)) {
        this.logger.warn(
          '@maxmind/geoip2-node not installed. Install it with: npm install @maxmind/geoip2-node',
        );
        this.logger.warn('Geo-restriction checks will be skipped until database is configured');
        return;
      }

      // Dynamically import to avoid hard dependency
      const { Reader } = await import('@maxmind/geoip2-node');
      
      // Try to load the database file
      const dbPath = process.env.GEOLITE2_DB_PATH || 
        path.join(process.cwd(), 'data', 'GeoLite2-Country.mmdb');

      if (!fs.existsSync(dbPath)) {
        this.logger.warn(
          `GeoLite2 database not found at ${dbPath}. ` +
          'Download it from https://dev.maxmind.com/geoip/geolite2-free-geolocation-data',
        );
        return;
      }

      this.geoLiteDb = new Reader(dbPath);
      this.geoLiteInitialized = true;
      this.logger.log('GeoLite2 database initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize GeoLite2: ${error.message}`);
      this.logger.warn('Geo-restriction checks will be skipped');
    }
  }

  private getClientIp(request: Request): string | null {
    // Check X-Forwarded-For header (for proxied requests)
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }

    // Check X-Real-IP header
    const realIp = request.headers['x-real-ip'];
    if (typeof realIp === 'string') {
      return realIp;
    }

    // Fall back to connection IP
    return request.ip || null;
  }

  private extractProjectId(request: Request): string | null {
    // Try to extract from request body
    if (request.body && request.body.projectId) {
      return request.body.projectId;
    }

    // Try to extract from URL params
    if (request.params && request.params.projectId) {
      return request.params.projectId;
    }

    // Try to extract from query params
    if (request.query && request.query.projectId) {
      return request.query.projectId as string;
    }

    return null;
  }

  private async getProjectRestrictedRegions(projectId: string): Promise<string[]> {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { restrictedRegions: true },
      });
      
      return project?.restrictedRegions || [];
    } catch (error) {
      this.logger.error(`Failed to get project restricted regions: ${error.message}`);
      return [];
    }
  }

  private async lookupCountry(ip: string): Promise<string | null> {
    try {
      if (!this.geoLiteDb) {
        return null;
      }

      const response = this.geoLiteDb.country(ip);
      return response.country?.isoCode || null;
    } catch (error) {
      this.logger.error(`Failed to lookup country for IP ${ip}: ${error.message}`);
      return null;
    }
  }
}

/**
 * Decorator to mark routes as geo-restricted
 */
export const GeoRestricted = () => {
  return (target: any, key?: string, descriptor?: any) => {
    if (descriptor) {
      // Method decorator
      return {
        ...descriptor,
        value: function (...args: any[]) {
          return descriptor.value.apply(this, args);
        },
      };
    }
  };
};
