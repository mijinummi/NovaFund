import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AccountSecurityService {
  private readonly logger = new Logger(AccountSecurityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Submit a freeze request for an account
   */
  async submitFreezeRequest(
    userId: string,
    reporterId: string,
    reason: string,
    evidenceUrl?: string,
  ) {
    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if there's already a pending request
    const existingRequest = await this.prisma.accountFreezeRequest.findFirst({
      where: {
        userId,
        status: 'PENDING',
      },
    });

    if (existingRequest) {
      throw new BadRequestException('A freeze request is already pending for this account');
    }

    // Create the freeze request
    const request = await this.prisma.accountFreezeRequest.create({
      data: {
        userId,
        reporterId,
        reason,
        evidenceUrl,
      },
    });

    this.logger.log(`Freeze request submitted for user ${userId} by ${reporterId}`);

    return request;
  }

  /**
   * Admin review of freeze request
   */
  async reviewFreezeRequest(
    requestId: string,
    adminId: string,
    approved: boolean,
    adminNotes?: string,
  ) {
    const request = await this.prisma.accountFreezeRequest.findUnique({
      where: { id: requestId },
      include: { user: true },
    });

    if (!request) {
      throw new NotFoundException('Freeze request not found');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Request has already been reviewed');
    }

    const newStatus = approved ? 'APPROVED' : 'REJECTED';

    // Update the request
    const updatedRequest = await this.prisma.accountFreezeRequest.update({
      where: { id: requestId },
      data: {
        status: newStatus,
        adminNotes,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    });

    // If approved, freeze the account
    if (approved) {
      await this.prisma.user.update({
        where: { id: request.userId },
        data: { isFrozen: true },
      });

      this.logger.log(`Account ${request.userId} frozen by admin ${adminId}`);
    }

    return updatedRequest;
  }

  /**
   * Unfreeze an account (admin only)
   */
  async unfreezeAccount(userId: string, adminId: string, reason: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isFrozen) {
      throw new BadRequestException('Account is not frozen');
    }

    // Update user
    await this.prisma.user.update({
      where: { id: userId },
      data: { isFrozen: false },
    });

    // Log the unfreeze action (could create an audit log table)
    this.logger.log(`Account ${userId} unfrozen by admin ${adminId}. Reason: ${reason}`);

    return { success: true, message: 'Account unfrozen successfully' };
  }

  /**
   * Check if an account is frozen
   */
  async isAccountFrozen(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isFrozen: true },
    });

    return user?.isFrozen ?? false;
  }

  /**
   * Get freeze requests for a user
   */
  async getFreezeRequests(userId: string) {
    return this.prisma.accountFreezeRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get all pending freeze requests (admin)
   */
  async getPendingFreezeRequests() {
    return this.prisma.accountFreezeRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        user: {
          select: {
            id: true,
            walletAddress: true,
            reputationScore: true,
          },
        },
        reporter: {
          select: {
            id: true,
            walletAddress: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Validate if a transaction can proceed (used by relay service)
   */
  async canProceedWithTransaction(userId: string): Promise<{ allowed: boolean; reason?: string }> {
    const isFrozen = await this.isAccountFrozen(userId);

    if (isFrozen) {
      return {
        allowed: false,
        reason: 'Account is frozen due to security concerns',
      };
    }

    return { allowed: true };
  }
}