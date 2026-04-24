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
 * Intercom provider – creates conversations via the Intercom REST API.
 *
 * Required env vars:
 *   INTERCOM_ACCESS_TOKEN  – Personal access token or OAuth token
 *   INTERCOM_WORKSPACE_ID  – Intercom workspace / app ID (for identity verification)
 */
@Injectable()
export class IntercomProvider implements SupportProviderClient {
  private readonly logger = new Logger(IntercomProvider.name);
  private readonly baseUrl = 'https://api.intercom.io';
  private readonly accessToken: string;
  private readonly http: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.accessToken = this.config.get<string>('INTERCOM_ACCESS_TOKEN', '');
    this.http = axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Intercom-Version': '2.11',
      },
    });
  }

  async createTicket(payload: ExternalTicketPayload): Promise<ExternalTicketResult> {
    // Intercom uses "contacts" identified by external_id (our userId)
    const body: Record<string, unknown> = {
      message_type: 'conversation',
      subject: payload.subject,
      body: payload.body,
      contact: {
        external_id: payload.userId,
      },
    };

    // Attach on-chain context as a dedicated admin note after creation
    if (payload.tags?.length) {
      body['tags'] = payload.tags;
    }

    if (payload.priority) {
      body['custom_attributes'] = {
        priority: payload.priority,
        ...(payload.onChainContext
          ? { on_chain_context: JSON.stringify(payload.onChainContext) }
          : {}),
        ...(payload.customAttributes ?? {}),
      };
    } else if (payload.onChainContext) {
      body['custom_attributes'] = {
        on_chain_context: JSON.stringify(payload.onChainContext),
        ...(payload.customAttributes ?? {}),
      };
    }

    try {
      const { data } = await this.http.post('/conversations', body);

      const conversationId = data.id;
      const conversationUrl = `https://app.intercom.io/a/apps/${this.config.get('INTERCOM_WORKSPACE_ID', '')}/inbox/conversation/${conversationId}`;

      // Add on-chain context as an admin note if it was provided and not embedded
      if (payload.onChainContext && Object.keys(payload.onChainContext).length > 0) {
        try {
          await this.http.post(`/conversations/${conversationId}/reply`, {
            message_type: 'comment',
            type: 'admin',
            admin_id: this.config.get('INTERCOM_ADMIN_ID', ''),
            body: this.formatOnChainNote(payload.onChainContext),
          });
        } catch (noteErr) {
          this.logger.warn(
            'Failed to attach on-chain context note to Intercom conversation',
            noteErr,
          );
        }
      }

      return {
        providerTicketId: conversationId,
        conversationUrl,
      };
    } catch (err) {
      this.logger.error('Intercom createTicket failed', err?.response?.data || err);
      throw err;
    }
  }

  async addMessage(providerTicketId: string, message: ExternalMessagePayload): Promise<void> {
    const body: Record<string, unknown> = {
      message_type: 'comment',
      body: message.body,
    };

    if (message.senderRole === 'USER') {
      body['type'] = 'user';
      body['user_id'] = message.senderId;
    } else {
      body['type'] = 'admin';
      body['admin_id'] = this.config.get('INTERCOM_ADMIN_ID', '');
    }

    try {
      await this.http.post(`/conversations/${providerTicketId}/reply`, body);
    } catch (err) {
      this.logger.error('Intercom addMessage failed', err?.response?.data || err);
      throw err;
    }
  }

  async updateTicket(providerTicketId: string, update: ExternalTicketUpdate): Promise<void> {
    const body: Record<string, unknown> = {};

    if (update.status) {
      // Map internal statuses to Intercom conversation states
      const statusMap: Record<string, string> = {
        OPEN: 'open',
        IN_PROGRESS: 'open',
        WAITING_ON_USER: 'snoozed',
        RESOLVED: 'closed',
        CLOSED: 'closed',
      };
      body['status'] = statusMap[update.status] ?? 'open';
    }

    if (update.priority || update.tags) {
      body['custom_attributes'] = {
        ...(update.priority ? { priority: update.priority } : {}),
      };
    }

    if (update.tags?.length) {
      try {
        await this.http.post('/tags', {
          name: update.tags.join(','),
          conversations: [{ id: providerTicketId }],
        });
      } catch (tagErr) {
        this.logger.warn('Intercom tag application failed', tagErr?.response?.data || tagErr);
      }
    }

    if (Object.keys(body).length > 0) {
      try {
        await this.http.put(`/conversations/${providerTicketId}`, body);
      } catch (err) {
        this.logger.error('Intercom updateTicket failed', err?.response?.data || err);
        throw err;
      }
    }
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      await this.http.get('/me');
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: err?.message };
    }
  }

  private formatOnChainNote(context: Record<string, unknown>): string {
    const lines = ['<b>🔗 On-Chain Activity Context (auto-attached)</b><br/>'];
    for (const [key, value] of Object.entries(context)) {
      lines.push(`<b>${key}:</b> ${JSON.stringify(value)}<br/>`);
    }
    return lines.join('');
  }
}
