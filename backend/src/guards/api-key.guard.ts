import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma.service';
import { SCOPES_KEY } from '../decorators/scopes.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey) {
      throw new UnauthorizedException('API key is missing');
    }

    // Find the API key in the database
    const apiKeyRecord = await this.prisma.apiKey.findUnique({
      where: { key: apiKey as string },
      include: { user: true },
    });

    if (!apiKeyRecord) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Attach user and key info to request
    request.user = apiKeyRecord.user;
    request.apiKey = apiKeyRecord;

    // Check for required scopes
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredScopes || requiredScopes.length === 0) {
      return true;
    }

    // Verify if the API key has all required scopes
    const hasScope = requiredScopes.every((scope) =>
      apiKeyRecord.scopes.includes(scope),
    );

    if (!hasScope) {
      throw new ForbiddenException('Insufficient permissions (missing required scopes)');
    }

    return true;
  }
}
