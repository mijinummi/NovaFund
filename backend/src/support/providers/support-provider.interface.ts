/**
 * Abstraction for third-party support desk providers (Intercom, Zendesk, etc.).
 * Every provider must implement this interface so the SupportService can
 * delegate ticket creation, updates, and messaging uniformly.
 */
export interface SupportProviderClient {
  /**
   * Create a conversation / ticket in the external provider and return
   * the provider-specific ticket ID and a URL for the agent dashboard.
   */
  createTicket(payload: ExternalTicketPayload): Promise<ExternalTicketResult>;

  /**
   * Append a message from the user to the existing external conversation.
   */
  addMessage(providerTicketId: string, message: ExternalMessagePayload): Promise<void>;

  /**
   * Update ticket metadata (status, priority, tags) in the external provider.
   */
  updateTicket(providerTicketId: string, update: ExternalTicketUpdate): Promise<void>;

  /**
   * Return the health / connectivity status of the provider.
   */
  healthCheck(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
}

export interface ExternalTicketPayload {
  userId: string;
  email?: string;
  subject: string;
  body: string;
  priority: string;
  tags: string[];
  /** JSON-serialised on-chain context that will be attached as a note */
  onChainContext?: Record<string, unknown>;
  /** Custom attributes specific to the provider */
  customAttributes?: Record<string, unknown>;
}

export interface ExternalTicketResult {
  providerTicketId: string;
  conversationUrl: string;
}

export interface ExternalMessagePayload {
  senderId: string;
  senderRole: 'USER' | 'AGENT' | 'SYSTEM';
  body: string;
  attachments?: Array<{ url: string; name: string; type: string }>;
}

export interface ExternalTicketUpdate {
  status?: string;
  priority?: string;
  assignedTo?: string;
  tags?: string[];
}
