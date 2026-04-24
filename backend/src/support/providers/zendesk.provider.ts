import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  SupportProviderClient,
  ExternalTicketPayload,
  ExternalTicketResult,
  ExternalMessagePayload,
  ExternalTicketUpdate,
} from './support-provider.interface';

/**
 * Zendesk provider – creates tickets via the Zendesk REST API v2.
 *
 * Required env vars:
 *   ZENDESK_SUBDOMAIN   – e.g. "novafund" → https://novafund.zendesk.com
 *   ZENDESK_EMAIL       – Agent/admin email for API auth
 *   ZENDESK_API_TOKEN   – Zendesk API token
 */
@Injectable()
export class ZendeskProvider implements SupportProviderClient {
  private readonly logger = new Logger(ZendeskProvider.name);
  private readonly http: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    const subdomain = this.config.get<string>('ZENDESK_SUBDOMAIN', '');
    const email = this.config.get<string>('ZENDESK_EMAIL', '');
    const apiToken = this.config.get<string>('ZENDESK_API_TOKEN', '');

    this.http = axios.create({
      baseURL: `https://${subdomain}.zendesk.com/api/v2`,
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}/token:${apiToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async createTicket(payload: ExternalTicketPayload): Promise<ExternalTicketResult> {
    const priorityMap: Record<string, string> = {
      LOW: 'low',
      MEDIUM: 'normal',
      HIGH: 'high',
      CRITICAL: 'urgent',
    };

    const body = {
      ticket: {
        subject: payload.subject,
        comment: {
          body: payload.body,
        },
        priority: priorityMap[payload.priority] ?? 'normal',
        tags: payload.tags,
        external_id: payload.userId,
        custom_fields: [
          ...(payload.onChainContext
            ? [
                {
                  id: this.config.get<string>('ZENDESK_ON_CHAIN_CONTEXT_FIELD_ID', ''),
                  value: JSON.stringify(payload.onChainContext),
                },
              ]
            : []),
          ...Object.entries(payload.customAttributes ?? {}).map(([id, value]) => ({
            id,
            value: String(value),
          })),
        ],
      },
    };

    try {
      const { data } = await this.http.post('/tickets.json', body);

      const ticketId = data.ticket.id;
      const conversationUrl = `https://${this.config.get('ZENDESK_SUBDOMAIN', '')}.zendesk.com/agent/tickets/${ticketId}`;

      return {
        providerTicketId: String(ticketId),
        conversationUrl,
      };
    } catch (err) {
      this.logger.error('Zendesk createTicket failed', err?.response?.data || err);
      throw err;
    }
  }

  async addMessage(providerTicketId: string, message: ExternalMessagePayload): Promise<void> {
    const body = {
      ticket: {
        comment: {
          body: message.body,
          author_id:
            message.senderRole === 'USER'
              ? message.senderId
              : this.config.get<string>('ZENDESK_AGENT_ID', ''),
          ...(message.attachments?.length
            ? { uploads: message.attachments.map((a) => a.url) }
            : {}),
        },
      },
    };

    try {
      await this.http.put(`/tickets/${providerTicketId}.json`, body);
    } catch (err) {
      this.logger.error('Zendesk addMessage failed', err?.response?.data || err);
      throw err;
    }
  }

  async updateTicket(providerTicketId: string, update: ExternalTicketUpdate): Promise<void> {
    const statusMap: Record<string, string> = {
      OPEN: 'open',
      IN_PROGRESS: 'open',
      WAITING_ON_USER: 'pending',
      RESOLVED: 'solved',
      CLOSED: 'closed',
    };

    const body: Record<string, unknown> = {
      ticket: {},
    };

    const ticket = body.ticket as Record<string, unknown>;

    if (update.status) {
      ticket['status'] = statusMap[update.status] ?? 'open';
    }
    if (update.priority) {
      const priorityMap: Record<string, string> = {
        LOW: 'low',
        MEDIUM: 'normal',
        HIGH: 'high',
        CRITICAL: 'urgent',
      };
      ticket['priority'] = priorityMap[update.priority] ?? 'normal';
    }
    if (update.assignedTo) {
      ticket['assignee_id'] = update.assignedTo;
    }
    if (update.tags?.length) {
      ticket['tags'] = update.tags;
    }

    try {
      await this.http.put(`/tickets/${providerTicketId}.json`, body);
    } catch (err) {
      this.logger.error('Zendesk updateTicket failed', err?.response?.data || err);
      throw err;
    }
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      await this.http.get('/tickets.json?per_page=1');
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: err?.message };
    }
  }
}
