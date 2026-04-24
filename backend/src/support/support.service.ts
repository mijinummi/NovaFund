import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { IntercomProvider } from './providers/intercom.provider';
import { ZendeskProvider } from './providers/zendesk.provider';
import {
  SupportProviderClient,
  ExternalTicketPayload,
  ExternalMessagePayload,
  ExternalTicketUpdate,
} from './providers/support-provider.interface';
import {
  CreateSupportTicketDto,
  UpdateSupportTicketDto,
  CreateSupportMessageDto,
  SupportProviderDto,
} from './dto/support.dto';

/**
 * Core service for the Live Support feature.
 *
 * Responsibilities:
 *  1. Persist support tickets & messages locally (Prisma)
 *  2. Mirror every ticket/message to an external provider (Intercom or Zendesk)
 *  3. Automatically collect and attach the user's recent on-chain activity
 *     so support agents have full context without asking the user
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private readonly providers: Map<string, SupportProviderClient>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly intercom: IntercomProvider,
    private readonly zendesk: ZendeskProvider,
  ) {
    this.providers = new Map<string, SupportProviderClient>([
      [SupportProviderDto.INTERCOM, this.intercom],
      [SupportProviderDto.ZENDESK, this.zendesk],
    ]);
  }

  // ─── Ticket CRUD ──────────────────────────────────────────────────────

  /**
   * Create a new support ticket.
   * Automatically fetches the user's recent on-chain activity and attaches
   * it as context so the support agent can troubleshoot faster.
   */
  async createTicket(userId: string, dto: CreateSupportTicketDto) {
    // 1. Fetch user for context
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    // 2. Gather on-chain activity context
    const onChainContext = await this.gatherOnChainContext(userId, dto.transactionHash);

    // 3. Determine provider
    const providerName = dto.provider ?? this.getDefaultProvider();
    const provider = this.getProvider(providerName);

    // 4. Auto-escalate priority for frozen accounts or failed transactions
    const finalPriority = this.autoEscalatePriority(dto.priority ?? 'MEDIUM', onChainContext, {
      isFrozen: user.isFrozen,
    });

    // 5. Push to external provider
    const providerPayload: ExternalTicketPayload = {
      userId: user.id,
      email: user.email ?? undefined,
      subject: dto.subject,
      body: dto.description,
      priority: finalPriority,
      tags: dto.tags ?? [],
      onChainContext,
      customAttributes: {
        wallet_address: user.walletAddress,
        reputation_score: user.reputationScore,
        trust_score: user.trustScore,
        account_frozen: user.isFrozen,
        account_age_days: Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000),
      },
    };

    let providerResult: { providerTicketId: string; conversationUrl: string } | null = null;

    try {
      providerResult = await provider.createTicket(providerPayload);
    } catch (err) {
      // Provider failure should NOT block ticket creation locally.
      // The ticket will be synced later via a retry mechanism.
      this.logger.error(
        `External provider (${providerName}) ticket creation failed – storing locally only`,
        err,
      );
    }

    // 6. Persist locally
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        subject: dto.subject,
        description: dto.description,
        priority: finalPriority as any,
        provider: providerName as any,
        providerTicketId: providerResult?.providerTicketId,
        conversationUrl: providerResult?.conversationUrl,
        onChainContext: onChainContext as any,
        tags: dto.tags ?? [],
      },
    });

    // 7. Auto-create initial system message with on-chain context summary
    if (onChainContext && Object.keys(onChainContext).length > 0) {
      await this.prisma.supportMessage.create({
        data: {
          ticketId: ticket.id,
          senderRole: 'SYSTEM',
          body: this.formatOnChainSummary(onChainContext),
        },
      });
    }

    this.logger.log(`Support ticket ${ticket.id} created for user ${userId} via ${providerName}`);

    return this.enrichTicket(ticket);
  }

  /**
   * Retrieve a single ticket with its messages.
   */
  async getTicket(ticketId: string, userId: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }

    return ticket;
  }

  /**
   * List all tickets for a user, newest first.
   */
  async listTickets(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.supportTicket.count({ where: { userId } }),
    ]);

    return {
      data: tickets.map((t) => this.enrichTicket(t)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Update a ticket's status, priority, or assignment.
   */
  async updateTicket(ticketId: string, userId: string, dto: UpdateSupportTicketDto) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }

    // Push update to external provider
    if (ticket.providerTicketId) {
      const provider = this.getProvider(ticket.provider);
      const externalUpdate: ExternalTicketUpdate = {};

      if (dto.status) externalUpdate.status = dto.status;
      if (dto.priority) externalUpdate.priority = dto.priority;
      if (dto.assignedTo) externalUpdate.assignedTo = dto.assignedTo;
      if (dto.tags) externalUpdate.tags = dto.tags;

      try {
        await provider.updateTicket(ticket.providerTicketId, externalUpdate);
      } catch (err) {
        this.logger.error(`Failed to sync ticket update to ${ticket.provider}`, err);
      }
    }

    // Persist locally
    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        ...(dto.priority ? { priority: dto.priority as any } : {}),
        ...(dto.status
          ? {
              status: dto.status as any,
              resolvedAt: ['RESOLVED', 'CLOSED'].includes(dto.status) ? new Date() : undefined,
            }
          : {}),
        ...(dto.assignedTo ? { assignedTo: dto.assignedTo } : {}),
        ...(dto.tags ? { tags: dto.tags } : {}),
      },
    });

    return this.enrichTicket(updated);
  }

  // ─── Messages ─────────────────────────────────────────────────────────

  /**
   * Add a message to a support ticket.
   */
  async addMessage(ticketId: string, userId: string, dto: CreateSupportMessageDto) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }

    // Auto-reopen if ticket was resolved/closed
    if (['RESOLVED', 'CLOSED'].includes(ticket.status)) {
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'OPEN' },
      });

      if (ticket.providerTicketId) {
        const provider = this.getProvider(ticket.provider);
        try {
          await provider.updateTicket(ticket.providerTicketId, { status: 'OPEN' });
        } catch (err) {
          this.logger.error('Failed to reopen ticket in external provider', err);
        }
      }
    }

    // Push message to external provider
    if (ticket.providerTicketId) {
      const provider = this.getProvider(ticket.provider);
      const externalMessage: ExternalMessagePayload = {
        senderId: userId,
        senderRole: 'USER',
        body: dto.body,
        attachments: dto.attachments,
      };

      try {
        await provider.addMessage(ticket.providerTicketId, externalMessage);
      } catch (err) {
        this.logger.error('Failed to sync message to external provider', err);
      }
    }

    // Persist locally
    const message = await this.prisma.supportMessage.create({
      data: {
        ticketId,
        senderId: userId,
        senderRole: 'USER',
        body: dto.body,
        attachments: dto.attachments as any,
      },
    });

    return message;
  }

  /**
   * List messages for a ticket.
   */
  async listMessages(ticketId: string, userId: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }

    return this.prisma.supportMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─── Provider Health ──────────────────────────────────────────────────

  /**
   * Check the health of all configured support providers.
   */
  async checkProvidersHealth() {
    const results: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

    const providerEntries = Array.from(this.providers.entries());
    for (const [name, provider] of providerEntries) {
      try {
        results[name] = await provider.healthCheck();
      } catch (err) {
        results[name] = { ok: false, error: err?.message };
      }
    }

    return results;
  }

  // ─── On-Chain Context ─────────────────────────────────────────────────

  /**
   * Gather a snapshot of the user's recent on-chain activity so support
   * agents have full context the moment a ticket is opened.
   *
   * This includes:
   *  - Recent contributions (investments)
   *  - Recent bridge transactions
   *  - Recent minted tokens
   *  - Active investment intents
   *  - Specific transaction details (if transactionHash provided)
   */
  private async gatherOnChainContext(
    userId: string,
    transactionHash?: string,
  ): Promise<Record<string, unknown>> {
    const context: Record<string, unknown> = {};

    try {
      // Recent contributions
      const recentContributions = await this.prisma.contribution.findMany({
        where: { investorId: userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          transactionHash: true,
          amount: true,
          projectId: true,
          timestamp: true,
        },
      });
      if (recentContributions.length > 0) {
        context['recent_contributions'] = recentContributions;
      }

      // User info for context
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { walletAddress: true, isFrozen: true, trustScore: true, reputationScore: true },
      });
      if (user) {
        context['wallet_address'] = user.walletAddress;
        context['account_frozen'] = user.isFrozen;
        context['trust_score'] = user.trustScore;
        context['reputation_score'] = user.reputationScore;
      }

      // Recent bridge transactions
      const userWallet = user?.walletAddress;
      if (userWallet) {
        const bridgeTxs = await this.prisma.bridgeTransaction.findMany({
          where: {
            OR: [{ senderAddress: userWallet }, { receiverAddress: userWallet }],
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            sourceTxHash: true,
            sourceChain: true,
            destChain: true,
            status: true,
            amount: true,
            asset: true,
            createdAt: true,
          },
        });
        if (bridgeTxs.length > 0) {
          context['recent_bridge_transactions'] = bridgeTxs;
        }
      }

      // Recent minted tokens
      if (userWallet) {
        const mintedTokens = await this.prisma.mintedToken.findMany({
          where: { recipient: userWallet },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            transactionHash: true,
            amount: true,
            contractId: true,
            mintedAt: true,
          },
        });
        if (mintedTokens.length > 0) {
          context['recent_minted_tokens'] = mintedTokens;
        }
      }

      // Active investment intents
      const activeIntents = await this.prisma.investmentIntent.findMany({
        where: {
          investorId: userId,
          status: { in: ['PENDING', 'APPROVED'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          projectId: true,
          investmentAmount: true,
          status: true,
          expiresAt: true,
        },
      });
      if (activeIntents.length > 0) {
        context['active_investment_intents'] = activeIntents;
      }

      // Specific transaction lookup if provided
      if (transactionHash) {
        const contribution = await this.prisma.contribution.findUnique({
          where: { transactionHash },
        });
        if (contribution) {
          context['referenced_transaction'] = contribution;
        }

        const bridgeTx = await this.prisma.bridgeTransaction.findUnique({
          where: { sourceTxHash: transactionHash },
        });
        if (bridgeTx) {
          context['referenced_bridge_transaction'] = bridgeTx;
        }

        const mintedToken = await this.prisma.mintedToken.findUnique({
          where: { transactionHash },
        });
        if (mintedToken) {
          context['referenced_mint_transaction'] = mintedToken;
        }
      }
    } catch (err) {
      this.logger.error('Failed to gather on-chain context – continuing without it', err);
    }

    return context;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private getProvider(name: string): SupportProviderClient {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Unknown support provider: ${name}`);
    }
    return provider;
  }

  private getDefaultProvider(): string {
    return this.config.get<string>('SUPPORT_DEFAULT_PROVIDER', 'INTERCOM');
  }

  /**
   * Automatically escalate ticket priority based on context signals:
   *  - Frozen accounts → HIGH
   *  - Failed bridge transactions → HIGH
   *  - Referenced transaction errors → CRITICAL
   */
  private autoEscalatePriority(
    currentPriority: string,
    onChainContext: Record<string, unknown>,
    user: { isFrozen: boolean },
  ): string {
    const priorityLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    let level = priorityLevels.indexOf(currentPriority);

    // Frozen account → at least HIGH
    if (user.isFrozen && level < 2) {
      level = 2;
    }

    // Failed bridge transactions → at least HIGH
    const bridgeTxs = onChainContext.recent_bridge_transactions as
      | Array<{ status: string }>
      | undefined;
    if (bridgeTxs?.some((tx) => tx.status === 'FAILED') && level < 2) {
      level = 2;
    }

    // Referenced failed bridge → CRITICAL
    const refBridge = onChainContext.referenced_bridge_transaction as
      | { status: string }
      | undefined;
    if (refBridge?.status === 'FAILED') {
      level = 3;
    }

    return priorityLevels[level];
  }

  /**
   * Format on-chain context into a human-readable summary message.
   */
  private formatOnChainSummary(context: Record<string, unknown>): string {
    const lines: string[] = ['🔗 Auto-attached On-Chain Activity Context:'];

    if (context.wallet_address) {
      lines.push(`  Wallet: ${context.wallet_address}`);
    }
    if (context.account_frozen) {
      lines.push(`  ⚠️ Account is FROZEN`);
    }
    if (context.trust_score) {
      lines.push(`  Trust Score: ${context.trust_score}`);
    }
    if (context.recent_contributions) {
      const count = (context.recent_contributions as unknown[]).length;
      lines.push(`  Recent Contributions: ${count}`);
    }
    if (context.recent_bridge_transactions) {
      const txs = context.recent_bridge_transactions as Array<{
        status: string;
        sourceChain: string;
        destChain: string;
      }>;
      lines.push(`  Recent Bridge Transactions: ${txs.length}`);
      const failed = txs.filter((t) => t.status === 'FAILED');
      if (failed.length > 0) {
        lines.push(`  ⚠️ ${failed.length} FAILED bridge transaction(s)`);
      }
    }
    if (context.active_investment_intents) {
      const count = (context.active_investment_intents as unknown[]).length;
      lines.push(`  Active Investment Intents: ${count}`);
    }
    if (context.referenced_transaction) {
      lines.push(`  Referenced Transaction: ${JSON.stringify(context.referenced_transaction)}`);
    }
    if (context.referenced_bridge_transaction) {
      lines.push(
        `  Referenced Bridge TX: ${JSON.stringify(context.referenced_bridge_transaction)}`,
      );
    }

    return lines.join('\n');
  }

  /**
   * Add computed fields to a ticket response.
   */
  private enrichTicket(ticket: any) {
    return {
      ...ticket,
      isOpen: !['RESOLVED', 'CLOSED'].includes(ticket.status),
    };
  }
}
