import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { PrismaService } from '../../prisma.service';
import { LedgerTrackerService } from './ledger-tracker.service';
import { EventHandlerService } from './event-handler.service';
import { DlqService } from './dlq.service';
import { RpcFallbackService } from '../../stellar/rpc-fallback.service';
import { SorobanEvent, ParsedContractEvent } from '../types/event-types';

/**
 * Service for indexing Soroban contract events
 * Polls Soroban RPC for events, tracks ledger state, handles re-orgs,
 * and maps events to database updates
 */
@Injectable()
export class SorobanEventIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SorobanEventIndexerService.name);
  private readonly network: string;
  private readonly pollIntervalMs: number;
  private readonly maxEventsPerFetch: number;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;
  private readonly contractIds: string[];

  private isRunning = false;
  private isShuttingDown = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly ledgerTracker: LedgerTrackerService,
    private readonly eventHandler: EventHandlerService,
    private readonly dlqService: DlqService,
    private readonly rpcFallbackService: RpcFallbackService,
  ) {
    // Initialize configuration
    this.network = this.configService.get<string>('STELLAR_NETWORK', 'testnet');
    this.pollIntervalMs = this.configService.get<number>('SOROBAN_INDEXER_POLL_INTERVAL_MS', 5000);
    this.maxEventsPerFetch = this.configService.get<number>('SOROBAN_INDEXER_MAX_EVENTS_PER_FETCH', 100);
    this.retryAttempts = this.configService.get<number>('SOROBAN_INDEXER_RETRY_ATTEMPTS', 3);
    this.retryDelayMs = this.configService.get<number>('SOROBAN_INDEXER_RETRY_DELAY_MS', 1000);

    // Get contract IDs to monitor - can be configured specifically for Soroban indexer
    this.contractIds = this.getContractIds();
  }

  /**
   * Get list of contract IDs to monitor from configuration
   * Can be different from the main indexer if needed
   */
  private getContractIds(): string[] {
    const contracts: string[] = [];

    // Add all configured contract IDs
    const projectLaunch = this.configService.get<string>('PROJECT_LAUNCH_CONTRACT_ID');
    if (projectLaunch) contracts.push(projectLaunch);

    const escrow = this.configService.get<string>('ESCROW_CONTRACT_ID');
    if (escrow) contracts.push(escrow);

    const profitDist = this.configService.get<string>('PROFIT_DISTRIBUTION_CONTRACT_ID');
    if (profitDist) contracts.push(profitDist);

    const subscription = this.configService.get<string>('SUBSCRIPTION_POOL_CONTRACT_ID');
    if (subscription) contracts.push(subscription);

    const governance = this.configService.get<string>('GOVERNANCE_CONTRACT_ID');
    if (governance) contracts.push(governance);

    const reputation = this.configService.get<string>('REPUTATION_CONTRACT_ID');
    if (reputation) contracts.push(reputation);

    const tokenFactory = this.configService.get<string>('TOKEN_FACTORY_CONTRACT_ID');
    if (tokenFactory) contracts.push(tokenFactory);

    // Add any additional Soroban-specific contracts
    const sorobanContracts = this.configService.get<string>('SOROBAN_CONTRACT_IDS');
    if (sorobanContracts) {
      contracts.push(...sorobanContracts.split(',').map(id => id.trim()));
    }

    return [...new Set(contracts)]; // Remove duplicates
  }

  /**
   * Lifecycle hook - called when module initializes
   */
  async onModuleInit(): Promise<void> {
    this.logger.log('Starting Soroban Event Indexer...');
    await this.initializeIndexer();
  }

  /**
   * Lifecycle hook - called when module destroys
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Shutting down Soroban Event Indexer...');
    this.isShuttingDown = true;

    // Wait for current processing to complete
    while (this.isRunning) {
      await this.sleep(100);
    }

    this.logger.log('Soroban Event Indexer shutdown complete');
  }

  /**
   * Initialize the indexer
   */
  private async initializeIndexer(): Promise<void> {
    try {
      // Test RPC connection
      const health = await this.rpcFallbackService.executeRpcOperation(
        async (server) => await server.getHealth(),
        'getHealth'
      );
      this.logger.log(`Soroban RPC Health: ${health.status}`);

      // Get latest ledger
      const latestLedger = await this.getLatestLedger();
      this.logger.log(`Latest Soroban ledger on network: ${latestLedger}`);

      // Initialize or resume from cursor
      const startLedger = await this.ledgerTracker.getStartLedger(latestLedger);
      this.logger.log(`Starting Soroban indexing from ledger ${startLedger}`);

      // Trigger initial sync
      await this.pollEvents();
    } catch (error) {
      this.logger.error(`Failed to initialize Soroban indexer: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Scheduled polling job - runs at configured interval
   */
  @Interval(5000) // Will use dynamic interval from config
  async scheduledPoll(): Promise<void> {
    if (this.isShuttingDown) return;
    await this.pollEvents();
  }

  /**
   * Main polling loop - fetches and processes Soroban events
   */
  async pollEvents(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Skipping Soroban poll - previous poll still running');
      return;
    }

    this.isRunning = true;

    try {
      // Get current cursor
      const cursor = await this.ledgerTracker.getLastCursor();
      const startLedger = cursor ? cursor.lastLedgerSeq + 1 : 1;

      // Get latest ledger from network
      const latestLedger = await this.getLatestLedger();

      // Check if there's anything to process
      if (startLedger > latestLedger) {
        this.logger.debug(`No new Soroban ledgers. Current: ${startLedger - 1}, Latest: ${latestLedger}`);
        return;
      }

      this.logger.log(`Polling Soroban events from ledger ${startLedger} to ${latestLedger}`);

      // Fetch events with retry logic
      const events = await this.fetchEventsWithRetry(startLedger, latestLedger);

      if (events.length === 0) {
        this.logger.debug('No Soroban events found in ledger range');
        // Still update cursor to show progress
        await this.ledgerTracker.updateCursor(latestLedger);
        return;
      }

      this.logger.log(`Found ${events.length} Soroban events to process`);

      // Process events
      let processedCount = 0;
      let errorCount = 0;

      for (const event of events) {
        try {
          const success = await this.processEvent(event);
          if (success) processedCount++;
        } catch (error) {
          errorCount++;
          this.logger.error(`Failed to process Soroban event ${event.id}: ${error.message}`);
          // Send to DLQ and continue — prevents a single bad event from blocking the loop
          await this.dlqService.push(event, error);
        }
      }

      // Update cursor to latest processed ledger
      await this.ledgerTracker.updateCursor(latestLedger);

      this.logger.log(`Processed ${processedCount}/${events.length} Soroban events (${errorCount} errors)`);

    } catch (error) {
      this.logger.error(`Error in Soroban polling loop: ${error.message}`, error.stack);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Fetch events from Soroban RPC with retry logic
   */
  private async fetchEventsWithRetry(startLedger: number, endLedger: number): Promise<SorobanEvent[]> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        return await this.fetchEvents(startLedger, endLedger);
      } catch (error) {
        lastError = error;
        this.logger.warn(`Soroban event fetch attempt ${attempt} failed: ${error.message}`);

        if (attempt < this.retryAttempts) {
          await this.sleep(this.retryDelayMs * attempt); // Exponential backoff
        }
      }
    }

    throw new Error(`Failed to fetch Soroban events after ${this.retryAttempts} attempts: ${lastError.message}`);
  }

  /**
   * Fetch events from Soroban RPC
   */
  private async fetchEvents(startLedger: number, endLedger: number): Promise<SorobanEvent[]> {
    const allEvents: SorobanEvent[] = [];

    // Fetch events for each contract
    for (const contractId of this.contractIds) {
      try {
        const events = await this.rpcFallbackService.executeRpcOperation(
          async (server) => {
            const response = await server.getEvents({
              startLedger,
              endLedger,
              contractIds: [contractId],
              limit: this.maxEventsPerFetch,
            });

            return response.events.map(event => ({
              type: event.type,
              ledger: event.ledger,
              ledgerClosedAt: event.ledgerClosedAt,
              contractId: event.contractId,
              id: event.id,
              pagingToken: event.pagingToken,
              topic: event.topic,
              value: event.value,
              inSuccessfulContractCall: event.inSuccessfulContractCall,
              txHash: event.txHash,
            }));
          },
          `getEvents-${contractId}`
        );

        allEvents.push(...events);
      } catch (error) {
        this.logger.error(`Failed to fetch events for contract ${contractId}: ${error.message}`);
        // Continue with other contracts
      }
    }

    // Sort events by ledger sequence
    allEvents.sort((a, b) => a.ledger - b.ledger);

    return allEvents;
  }

  /**
   * Process a single Soroban event
   */
  private async processEvent(event: SorobanEvent): Promise<boolean> {
    try {
      // Check if event already processed
      const existingEvent = await this.prisma.processedEvent.findUnique({
        where: { eventId: event.id },
      });

      if (existingEvent) {
        this.logger.debug(`Event ${event.id} already processed, skipping`);
        return true;
      }

      // Parse the event
      const parsedEvent = await this.parseEvent(event);

      // Handle the event
      await this.eventHandler.processEvent(parsedEvent);

      // Mark as processed
      await this.prisma.processedEvent.create({
        data: {
          eventId: event.id,
          network: this.network,
          ledgerSeq: event.ledger,
          contractId: event.contractId,
          eventType: parsedEvent.eventType,
          transactionHash: event.txHash,
        },
      });

      this.logger.debug(`Processed Soroban event ${event.id} of type ${parsedEvent.eventType}`);
      return true;

    } catch (error) {
      this.logger.error(`Failed to process Soroban event ${event.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse raw Soroban event into structured format
   */
  private async parseEvent(event: SorobanEvent): Promise<ParsedContractEvent> {
    // This would involve decoding the event topic and value
    // For now, return a basic structure - in practice, this would use
    // contract-specific decoding logic

    return {
      id: event.id,
      ledgerSeq: event.ledger,
      contractId: event.contractId,
      eventType: this.extractEventType(event.topic),
      data: this.decodeEventValue(event.value),
      txHash: event.txHash,
      timestamp: new Date(event.ledgerClosedAt),
    };
  }

  /**
   * Extract event type from topic
   */
  private extractEventType(topic: string[]): string {
    // Simple extraction - in practice, this would map to ContractEventType enum
    if (topic.length > 0) {
      return topic[0];
    }
    return 'unknown';
  }

  /**
   * Decode event value (simplified)
   */
  private decodeEventValue(value: string): any {
    // In practice, this would use stellar-sdk to decode XDR
    // For now, return the raw value
    return { rawValue: value };
  }

  /**
   * Get latest ledger from Soroban RPC
   */
  private async getLatestLedger(): Promise<number> {
    const ledgerInfo = await this.rpcFallbackService.executeRpcOperation(
      async (server) => await server.getLatestLedger(),
      'getLatestLedger'
    );

    return ledgerInfo.sequence;
  }

  /**
   * Utility sleep function
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { PrismaService } from '../../prisma.service';
import { RpcFallbackService } from '../../stellar/rpc-fallback.service';
import { SorobanEvent, ParsedContractEvent, ContractEventType } from '../types/event-types';
import { LedgerCursor } from '../types/ledger.types';

/**
 * Soroban Event Indexer Service
 *
 * Polls the Stellar/Soroban RPC API for contract events and maps them to database updates.
 * Handles last processed ledger tracking, re-org detection, and specific event mappings
 * for project_created, contribution_made, milestone_approved, funds_released, etc.
 */
@Injectable()
export class SorobanEventIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SorobanEventIndexerService.name);
  private readonly network: string;
  private readonly pollIntervalMs: number;
  private readonly maxEventsPerFetch: number;
  private readonly contractIds: string[];
  private readonly reorgDepthThreshold: number;

  private isRunning = false;
  private isShuttingDown = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly rpcFallbackService: RpcFallbackService,
  ) {
    this.network = this.configService.get<string>('STELLAR_NETWORK', 'testnet');
    this.pollIntervalMs = 5000; // Poll every 5 seconds as specified
    this.maxEventsPerFetch = this.configService.get<number>('INDEXER_MAX_EVENTS_PER_FETCH', 100);
    this.reorgDepthThreshold = this.configService.get<number>('INDEXER_REORG_DEPTH_THRESHOLD', 5);
    this.contractIds = this.getContractIds();
  }

  /**
   * Get contract IDs to monitor from configuration
   */
  private getContractIds(): string[] {
    const contracts: string[] = [];

    const projectLaunch = this.configService.get<string>('PROJECT_LAUNCH_CONTRACT_ID');
    if (projectLaunch) contracts.push(projectLaunch);

    const escrow = this.configService.get<string>('ESCROW_CONTRACT_ID');
    if (escrow) contracts.push(escrow);

    return contracts; // Focus on core contracts for now
  }

  /**
   * Lifecycle hook - called when module initializes
   */
  async onModuleInit(): Promise<void> {
    this.logger.log('Starting Soroban Event Indexer...');
    await this.initializeIndexer();
  }

  /**
   * Lifecycle hook - called when module destroys
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Shutting down Soroban Event Indexer...');
    this.isShuttingDown = true;

    while (this.isRunning) {
      await this.sleep(100);
    }

    this.logger.log('Soroban Event Indexer shutdown complete');
  }

  /**
   * Initialize the indexer
   */
  private async initializeIndexer(): Promise<void> {
    try {
      // Test RPC connection
      const health = await this.rpcFallbackService.executeRpcOperation(
        async (server) => await server.getHealth(),
        'getHealth'
      );
      this.logger.log(`RPC Health: ${health.status}`);

      // Get latest ledger
      const latestLedger = await this.getLatestLedger();
      this.logger.log(`Latest ledger on network: ${latestLedger}`);

      // Initialize cursor if needed
      await this.ensureCursorInitialized(latestLedger);

      this.logger.log('Soroban Event Indexer initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize indexer: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Scheduled polling job - runs every 5 seconds
   */
  @Interval(5000)
  async pollEvents(): Promise<void> {
    if (this.isShuttingDown || this.isRunning) return;

    this.isRunning = true;

    try {
      const cursor = await this.getLastCursor();
      const startLedger = cursor ? cursor.lastLedgerSeq + 1 : 1;
      const latestLedger = await this.getLatestLedger();

      if (startLedger > latestLedger) {
        this.logger.debug(`No new ledgers. Current: ${startLedger - 1}, Latest: ${latestLedger}`);
        return;
      }

      this.logger.log(`Polling Soroban events from ledger ${startLedger} to ${latestLedger}`);

      // Check for re-orgs
      await this.handleReorgs(cursor, latestLedger);

      // Fetch and process events
      const events = await this.fetchSorobanEvents(startLedger, latestLedger);
      const processedCount = await this.processEvents(events);

      // Update cursor
      await this.updateCursor(latestLedger);

      this.logger.log(`Processed ${processedCount}/${events.length} Soroban events`);
    } catch (error) {
      this.logger.error(`Error in poll cycle: ${error.message}`, error.stack);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Ensure cursor is initialized
   */
  private async ensureCursorInitialized(latestLedger: number): Promise<void> {
    const cursor = await this.getLastCursor();
    if (!cursor) {
      const startLedger = Math.max(1, latestLedger - 1000); // Start from recent ledger
      await this.prisma.ledgerCursor.create({
        data: {
          network: this.network,
          lastLedgerSeq: startLedger,
        },
      });
      this.logger.log(`Initialized cursor at ledger ${startLedger}`);
    }
  }

  /**
   * Get last processed ledger cursor
   */
  private async getLastCursor(): Promise<LedgerCursor | null> {
    const cursor = await this.prisma.ledgerCursor.findUnique({
      where: { network: this.network },
    });

    if (!cursor) return null;

    return {
      id: cursor.id,
      network: cursor.network,
      lastLedgerSeq: cursor.lastLedgerSeq,
      lastLedgerHash: cursor.lastLedgerHash || undefined,
      updatedAt: cursor.updatedAt,
      createdAt: cursor.createdAt,
    };
  }

  /**
   * Get latest ledger from network
   */
  private async getLatestLedger(): Promise<number> {
    const response = await this.rpcFallbackService.executeRpcOperation(
      async (server) => await server.getLatestLedger(),
      'getLatestLedger'
    );
    return response.sequence;
  }

  /**
   * Handle blockchain re-orgs
   */
  private async handleReorgs(cursor: LedgerCursor | null, latestLedger: number): Promise<void> {
    if (!cursor) return;

    // Check if we need to detect re-orgs (simplified version)
    const currentLedger = await this.getLedgerInfo(cursor.lastLedgerSeq);
    if (currentLedger && currentLedger.hash !== cursor.lastLedgerHash) {
      this.logger.warn(`Re-org detected at ledger ${cursor.lastLedgerSeq}`);

      // Rollback processed events from this ledger
      await this.rollbackEventsFromLedger(cursor.lastLedgerSeq);

      // Reset cursor to re-org depth
      const rollbackTo = Math.max(1, cursor.lastLedgerSeq - this.reorgDepthThreshold);
      await this.updateCursor(rollbackTo);

      this.logger.log(`Rolled back to ledger ${rollbackTo} due to re-org`);
    }
  }

  /**
   * Get ledger info for re-org detection
   */
  private async getLedgerInfo(sequence: number): Promise<{ hash: string } | null> {
    try {
      const response = await this.rpcFallbackService.executeRpcOperation(
        async (server) => await server.getLedger(sequence),
        'getLedger'
      );
      return { hash: response.hash };
    } catch (error) {
      this.logger.warn(`Failed to get ledger ${sequence} info: ${error.message}`);
      return null;
    }
  }

  /**
   * Rollback events from a specific ledger
   */
  private async rollbackEventsFromLedger(ledgerSeq: number): Promise<void> {
    // Delete processed events from this ledger
    await this.prisma.processedEvent.deleteMany({
      where: {
        network: this.network,
        ledgerSeq: ledgerSeq,
      },
    });

    // Rollback database changes (simplified - would need specific logic per event type)
    this.logger.log(`Rolled back events from ledger ${ledgerSeq}`);
  }

  /**
   * Fetch Soroban contract events
   */
  private async fetchSorobanEvents(startLedger: number, endLedger: number): Promise<SorobanEvent[]> {
    const events: SorobanEvent[] = [];
    let cursor: string | undefined;

    const filters: SorobanRpc.Api.EventFilter[] = [
      {
        type: 'contract',
        contractIds: this.contractIds,
      },
    ];

    do {
      const request = {
        startLedger,
        filters,
        limit: this.maxEventsPerFetch,
        cursor,
      };

      const response = await this.rpcFallbackService.executeRpcOperation(
        async (server) => await server.getEvents(request),
        'getEvents'
      );

      if (response.events) {
        for (const event of response.events) {
          if (event.ledger <= endLedger) {
            events.push(this.transformRpcEvent(event));
          }
        }
      }

      cursor = (response as any).cursor;

      if (events.length >= this.maxEventsPerFetch * 5) {
        this.logger.warn(`Event fetch limit reached. Processing ${events.length} events.`);
        break;
      }
    } while (cursor);

    return events;
  }

  /**
   * Transform RPC event to internal format
   */
  private transformRpcEvent(event: SorobanRpc.Api.EventResponse): SorobanEvent {
    return {
      type: event.type,
      ledger: event.ledger,
      ledgerClosedAt: event.ledgerClosedAt,
      contractId: event.contractId.toString(),
      id: event.id,
      pagingToken: event.pagingToken,
      topic: event.topic.map((t: any) => t.toString()),
      value: event.value.toString(),
      inSuccessfulContractCall: event.inSuccessfulContractCall,
      txHash: (event as any).txHash || (event as any).transactionHash || '',
    };
  }

  /**
   * Process events and map to database updates
   */
  private async processEvents(events: SorobanEvent[]): Promise<number> {
    let processedCount = 0;

    for (const event of events) {
      try {
        if (await this.isEventProcessed(event.id)) {
          continue;
        }

        const parsedEvent = this.parseEvent(event);
        if (!parsedEvent) continue;

        await this.handleEvent(parsedEvent);
        await this.markEventProcessed(event);

        processedCount++;
      } catch (error) {
        this.logger.error(`Failed to process event ${event.id}: ${error.message}`);
      }
    }

    return processedCount;
  }

  /**
   * Check if event is already processed
   */
  private async isEventProcessed(eventId: string): Promise<boolean> {
    const existing = await this.prisma.processedEvent.findUnique({
      where: { eventId },
    });
    return !!existing;
  }

  /**
   * Parse raw event into structured format
   */
  private parseEvent(event: SorobanEvent): ParsedContractEvent | null {
    try {
      // Extract event type from topic
      const eventType = this.extractEventType(event.topic);
      if (!eventType) return null;

      // Parse event data based on type
      const data = this.parseEventData(eventType, event.value);

      return {
        id: event.id,
        eventType,
        contractId: event.contractId,
        ledger: event.ledger,
        txHash: event.txHash,
        data,
        timestamp: new Date(event.ledgerClosedAt),
      };
    } catch (error) {
      this.logger.warn(`Failed to parse event ${event.id}: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract event type from topic symbols
   */
  private extractEventType(topic: string[]): ContractEventType | null {
    const eventSymbol = topic[0];
    switch (eventSymbol) {
      case 'proj_new': return ContractEventType.PROJECT_CREATED;
      case 'contrib': return ContractEventType.CONTRIBUTION_MADE;
      case 'm_apprv': return ContractEventType.MILESTONE_APPROVED;
      case 'release': return ContractEventType.FUNDS_RELEASED;
      case 'proj_fund': return ContractEventType.PROJECT_FUNDED;
      case 'proj_done': return ContractEventType.PROJECT_COMPLETED;
      case 'refund': return ContractEventType.REFUND_ISSUED;
      default: return null;
    }
  }

  /**
   * Parse event data from XDR value
   */
  private parseEventData(eventType: ContractEventType, value: string): any {
    // Simplified parsing - in real implementation would decode XDR
    // For now, return a basic structure
    return { rawValue: value };
  }

  /**
   * Handle specific event types and map to database updates
   */
  private async handleEvent(event: ParsedContractEvent): Promise<void> {
    switch (event.eventType) {
      case ContractEventType.PROJECT_CREATED:
        await this.handleProjectCreated(event);
        break;
      case ContractEventType.CONTRIBUTION_MADE:
        await this.handleContributionMade(event);
        break;
      case ContractEventType.MILESTONE_APPROVED:
        await this.handleMilestoneApproved(event);
        break;
      case ContractEventType.FUNDS_RELEASED:
        await this.handleFundsReleased(event);
        break;
      default:
        this.logger.debug(`Unhandled event type: ${event.eventType}`);
    }
  }

  /**
   * Handle project created event
   */
  private async handleProjectCreated(event: ParsedContractEvent): Promise<void> {
    // Implementation would extract project data from event and create/update project record
    this.logger.log(`Project created: ${event.contractId}`);
    // TODO: Implement database update
  }

  /**
   * Handle contribution made event
   */
  private async handleContributionMade(event: ParsedContractEvent): Promise<void> {
    // Implementation would extract contribution data and create contribution record
    this.logger.log(`Contribution made to project: ${event.contractId}`);
    // TODO: Implement database update
  }

  /**
   * Handle milestone approved event
   */
  private async handleMilestoneApproved(event: ParsedContractEvent): Promise<void> {
    // Implementation would update milestone status
    this.logger.log(`Milestone approved for project: ${event.contractId}`);
    // TODO: Implement database update
  }

  /**
   * Handle funds released event
   */
  private async handleFundsReleased(event: ParsedContractEvent): Promise<void> {
    // Implementation would update project/milestone funding status
    this.logger.log(`Funds released for project: ${event.contractId}`);
    // TODO: Implement database update
  }

  /**
   * Mark event as processed
   */
  private async markEventProcessed(event: SorobanEvent): Promise<void> {
    await this.prisma.processedEvent.create({
      data: {
        eventId: event.id,
        network: this.network,
        ledgerSeq: event.ledger,
        contractId: event.contractId,
        eventType: this.extractEventType(event.topic)?.toString() || 'unknown',
        transactionHash: event.txHash,
      },
    });
  }

  /**
   * Update ledger cursor
   */
  private async updateCursor(ledgerSeq: number, hash?: string): Promise<void> {
    await this.prisma.ledgerCursor.upsert({
      where: { network: this.network },
      update: {
        lastLedgerSeq: ledgerSeq,
        lastLedgerHash: hash,
      },
      create: {
        network: this.network,
        lastLedgerSeq: ledgerSeq,
        lastLedgerHash: hash,
      },
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}