import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(private prisma: PrismaService) {}

  async trackReferredVolume(referrerId: string, referredId: string, volume: number): Promise<void> {
    await this.prisma.referral.upsert({
      where: {
        referrerId_referredId: {
          referrerId,
          referredId,
        },
      },
      update: {
        totalVolume: { increment: volume },
        updatedAt: new Date(),
      },
      create: {
        referrerId,
        referredId,
        totalVolume: volume,
      },
    });
    this.logger.log(`Tracked volume ${volume} for referral ${referrerId} -> ${referredId}`);
  }

  async calculateROI(referrerId: string): Promise<number> {
    const referrals = await this.prisma.referral.findMany({
      where: { referrerId },
      include: {
        referred: {
          include: {
            contributions: true,
          },
        },
      },
    });

    let totalROI = 0;
    for (const referral of referrals) {
      const referredVolume = referral.referred.contributions.reduce(
        (sum, contribution) => sum + contribution.amount,
        0
      );
      totalROI += referredVolume;
    }

    return totalROI;
  }

  async getTieredReward(referrerId: string): Promise<number> {
    const roi = await this.calculateROI(referrerId);

    // Tiered rewards based on ROI milestones
    if (roi >= 50000) return 0.15; // 15% for top tier
    if (roi >= 25000) return 0.10; // 10%
    if (roi >= 10000) return 0.07; // 7%
    if (roi >= 5000) return 0.05; // 5%
    return 0.02; // 2% base
  }

  async getLeaderboard(limit: number = 10): Promise<Array<{ referrerId: string; roi: number; reward: number }>> {
    const allReferrers = await this.prisma.referral.groupBy({
      by: ['referrerId'],
      _sum: {
        totalVolume: true,
      },
    });

    const leaderboard = await Promise.all(
      allReferrers.map(async (group) => {
        const roi = group._sum.totalVolume || 0;
        const reward = await this.getTieredReward(group.referrerId);
        return {
          referrerId: group.referrerId,
          roi,
          reward,
        };
      })
    );

    return leaderboard
      .sort((a, b) => b.roi - a.roi)
      .slice(0, limit);
  }

  async updateReferralRewards(): Promise<void> {
    const referrals = await this.prisma.referral.findMany();

    for (const referral of referrals) {
      const reward = await this.getTieredReward(referral.referrerId);
      await this.prisma.referral.update({
        where: { id: referral.id },
        data: { rewardPercentage: reward },
      });
    }

    this.logger.log('Updated referral rewards for all referrers');
  }
}