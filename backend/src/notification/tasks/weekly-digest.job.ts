import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma.service';
import { EmailService } from '../services/email.service';

@Injectable()
export class WeeklyDigestJob {
  private readonly logger = new Logger(WeeklyDigestJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  // Run every Sunday at 9:00 AM UTC
  @Cron('0 9 * * 0')
  async handleCron() {
    this.logger.log('Starting weekly digest generation...');

    try {
      // Get all users who prefer weekly digest
      const usersWithDigest = await this.prisma.notificationSetting.findMany({
        where: {
          emailEnabled: true,
          emailDigestMode: 'WEEKLY',
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              walletAddress: true,
            },
          },
        },
      });

      this.logger.log(`Found ${usersWithDigest.length} users with weekly digest enabled`);

      for (const setting of usersWithDigest) {
        if (!setting.user.email) {
          continue;
        }

        try {
          await this.sendDigestEmail(setting.user.id, setting.user.email);
        } catch (error) {
          this.logger.error(
            `Failed to send digest email to ${setting.user.email}: ${error.message}`,
          );
        }
      }

      this.logger.log('Weekly digest generation completed');
    } catch (error) {
      this.logger.error(`Weekly digest job failed: ${error.message}`);
    }
  }

  private async sendDigestEmail(userId: string, email: string): Promise<void> {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Aggregate data for the past week
    const [
      userContributions,
      newProjects,
      milestoneUpdates,
      yieldEarnings,
    ] = await Promise.all([
      // User's contributions in the past week
      this.prisma.contribution.findMany({
        where: {
          investorId: userId,
          timestamp: {
            gte: oneWeekAgo,
          },
        },
        include: {
          project: {
            select: {
              title: true,
              status: true,
            },
          },
        },
        orderBy: {
          timestamp: 'desc',
        },
        take: 10,
      }),

      // New projects launched this week
      this.prisma.project.count({
        where: {
          createdAt: {
            gte: oneWeekAgo,
          },
          status: 'ACTIVE',
        },
      }),

      // Milestone updates for user's projects
      this.prisma.milestone.findMany({
        where: {
          project: {
            creatorId: userId,
          },
          updatedAt: {
            gte: oneWeekAgo,
          },
        },
        include: {
          project: {
            select: {
              title: true,
            },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
        take: 5,
      }),

      // Yield earnings (if applicable)
      this.prisma.yieldEvent.findMany({
        where: {
          createdAt: {
            gte: oneWeekAgo,
          },
          isActive: true,
        },
        take: 5,
      }),
    ]);

    // Generate HTML email content
    const html = this.generateDigestHtml(
      userContributions,
      newProjects,
      milestoneUpdates,
      yieldEarnings,
    );

    const subject = `Your NovaFund Weekly Digest - ${this.getWeekDates()}`;

    await this.emailService.sendEmail(email, subject, html);
    this.logger.log(`Weekly digest sent to ${email}`);
  }

  private generateDigestHtml(
    contributions: any[],
    newProjectsCount: number,
    milestones: any[],
    yieldEvents: any[],
  ): string {
    const totalContributed = contributions.reduce(
      (sum, c) => sum + Number(c.amount),
      0,
    );

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 30px;
          }
          .header h1 {
            margin: 0;
            font-size: 28px;
          }
          .section {
            margin-bottom: 30px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
          }
          .section h2 {
            color: #667eea;
            margin-top: 0;
            font-size: 20px;
          }
          .stat {
            display: inline-block;
            padding: 10px 20px;
            background: white;
            border-radius: 6px;
            margin: 5px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #667eea;
          }
          .stat-label {
            font-size: 12px;
            color: #666;
          }
          .item {
            padding: 10px;
            background: white;
            border-left: 3px solid #667eea;
            margin: 10px 0;
            border-radius: 4px;
          }
          .footer {
            text-align: center;
            color: #999;
            font-size: 12px;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #eee;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>📊 Your Weekly NovaFund Digest</h1>
          <p>Here's what happened this week</p>
        </div>

        <div class="section">
          <h2>📈 Quick Stats</h2>
          <div class="stat">
            <div class="stat-value">${contributions.length}</div>
            <div class="stat-label">New Investments</div>
          </div>
          <div class="stat">
            <div class="stat-value">${newProjectsCount}</div>
            <div class="stat-label">New Projects</div>
          </div>
          <div class="stat">
            <div class="stat-value">${milestones.length}</div>
            <div class="stat-label">Milestone Updates</div>
          </div>
        </div>

        ${contributions.length > 0 ? `
          <div class="section">
            <h2>💰 Your Recent Investments</h2>
            ${contributions
              .map(
                (c) => `
              <div class="item">
                <strong>${c.project.title}</strong><br>
                <span style="color: #666; font-size: 14px;">
                  Amount: ${Number(c.amount).toLocaleString()} tokens | 
                  Status: ${c.project.status}
                </span>
              </div>
            `,
              )
              .join('')}
          </div>
        ` : ''}

        ${milestones.length > 0 ? `
          <div class="section">
            <h2>🎯 Milestone Updates</h2>
            ${milestones
              .map(
                (m) => `
              <div class="item">
                <strong>${m.title}</strong> - ${m.project.title}<br>
                <span style="color: #666; font-size: 14px;">
                  Status: ${m.status}
                </span>
              </div>
            `,
              )
              .join('')}
          </div>
        ` : ''}

        <div class="footer">
          <p>This email was sent to you by NovaFund</p>
          <p>
            <a href="${process.env.FRONTEND_URL || 'https://novafund.xyz'}/settings">
              Manage notification preferences
            </a>
          </p>
        </div>
      </body>
      </html>
    `;
  }

  private getWeekDates(): string {
    const now = new Date();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const formatDate = (date: Date) => {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    };

    return `${formatDate(oneWeekAgo)} - ${formatDate(now)}`;
  }
}
