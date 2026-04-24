import { Controller, Get, Post, Put, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { SupportService } from './support.service';
import {
  CreateSupportTicketDto,
  UpdateSupportTicketDto,
  CreateSupportMessageDto,
} from './dto/support.dto';
import { ApiKeyGuard } from '../guards/api-key.guard';

@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  // ─── Tickets ──────────────────────────────────────────────────────────

  /**
   * POST /support/tickets
   * Create a new support ticket. On-chain context is auto-attached.
   *
   * Body: { subject, description, priority?, provider?, tags?, transactionHash? }
   */
  @Post('tickets')
  async createTicket(@Req() req: any, @Body() dto: CreateSupportTicketDto) {
    // Extract userId from authenticated request (fallback to body or header for API key auth)
    const userId = req?.user?.id ?? req.headers['x-user-id'];
    return this.supportService.createTicket(userId, dto);
  }

  /**
   * GET /support/tickets
   * List all tickets for the authenticated user.
   */
  @Get('tickets')
  async listTickets(@Req() req: any, @Query('page') page?: string, @Query('limit') limit?: string) {
    const userId = req?.user?.id ?? req.headers['x-user-id'];
    return this.supportService.listTickets(
      userId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  /**
   * GET /support/tickets/:ticketId
   * Get a single ticket with its messages.
   */
  @Get('tickets/:ticketId')
  async getTicket(@Req() req: any, @Param('ticketId') ticketId: string) {
    const userId = req?.user?.id ?? req.headers['x-user-id'];
    return this.supportService.getTicket(ticketId, userId);
  }

  /**
   * PUT /support/tickets/:ticketId
   * Update ticket status, priority, or tags.
   */
  @Put('tickets/:ticketId')
  async updateTicket(
    @Req() req: any,
    @Param('ticketId') ticketId: string,
    @Body() dto: UpdateSupportTicketDto,
  ) {
    const userId = req?.user?.id ?? req.headers['x-user-id'];
    return this.supportService.updateTicket(ticketId, userId, dto);
  }

  // ─── Messages ─────────────────────────────────────────────────────────

  /**
   * POST /support/tickets/:ticketId/messages
   * Add a message to an existing ticket.
   */
  @Post('tickets/:ticketId/messages')
  async addMessage(
    @Req() req: any,
    @Param('ticketId') ticketId: string,
    @Body() dto: CreateSupportMessageDto,
  ) {
    const userId = req?.user?.id ?? req.headers['x-user-id'];
    return this.supportService.addMessage(ticketId, userId, dto);
  }

  /**
   * GET /support/tickets/:ticketId/messages
   * List all messages for a ticket.
   */
  @Get('tickets/:ticketId/messages')
  async listMessages(@Req() req: any, @Param('ticketId') ticketId: string) {
    const userId = req?.user?.id ?? req.headers['x-user-id'];
    return this.supportService.listMessages(ticketId, userId);
  }

  // ─── Provider Health ──────────────────────────────────────────────────

  /**
   * GET /support/health
   * Check the health of configured support providers.
   * Protected by API key for admin use.
   */
  @Get('health')
  @UseGuards(ApiKeyGuard)
  async checkProvidersHealth() {
    return this.supportService.checkProvidersHealth();
  }
}
