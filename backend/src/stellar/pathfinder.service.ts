import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { RpcFallbackService } from './rpc-fallback.service';

/**
 * Represents a single step in a payment path
 */
export interface PathStep {
  asset: {
    code: string;
    issuer?: string;
  };
  amount: string;
}

/**
 * Represents a complete payment path from source to destination
 */
export interface PaymentPath {
  steps: PathStep[];
  sourceAsset: {
    code: string;
    issuer?: string;
  };
  destinationAsset: {
    code: string;
    issuer?: string;
  };
  sourceAmount: string;
  destinationAmount: string;
  estimatedFeePercentage: number;
  estimatedFeeAmount: string;
  conversionRate: number;
  hopCount: number;
  executableImmediately: boolean;
  lastUpdated: Date;
}

/**
 * Route analysis for comparing multiple paths
 */
export interface RouteAnalysis {
  bestPath: PaymentPath;
  alternativePaths: PaymentPath[];
  recommendation: string;
  totalRoutingMetrics: {
    avgFeePercentage: number;
    bestConversionRate: number;
    worstConversionRate: number;
  };
}

/**
 * Pathfinder Service - Smart Order Routing for Multi-Asset Funding
 * 
 * Uses Stellar's PathPayment capabilities to find optimal routes between any assets
 * considering fees, liquidity, and conversion rates.
 */
@Injectable()
export class PathfinderService {
  private readonly logger = new Logger(PathfinderService.name);
  private horizonServer: Horizon.Server;
  private readonly networkPassphrase: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly rpcFallback: RpcFallbackService,
  ) {
    const horizonUrl = this.configService.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    );
    
    this.networkPassphrase = this.configService.get<string>(
      'STELLAR_NETWORK_PASSPHRASE',
      Networks.TESTNET,
    );

    this.horizonServer = new Horizon.Server(horizonUrl);
    this.logger.log(`PathfinderService initialized with Horizon: ${horizonUrl}`);
  }

  /**
   * Find the best payment path from source asset to destination asset
   * 
   * @param sourceAssetCode - Code of the asset the user has (e.g., 'EURC')
   * @param sourceAssetIssuer - Issuer address of source asset (optional for native XLM)
   * @param destinationAssetCode - Code of the asset the project wants (e.g., 'USDC')
   * @param destinationAssetIssuer - Issuer address of destination asset
   * @param sourceAmount - Amount of source asset to swap
   * @returns The best payment path with detailed analysis
   */
  async findBestPath(
    sourceAssetCode: string,
    destinationAssetCode: string,
    destinationAssetIssuer: string,
    sourceAmount: string,
    sourceAssetIssuer?: string,
  ): Promise<PaymentPath> {
    try {
      this.logger.debug(
        `Finding path from ${sourceAssetCode} (${sourceAssetIssuer || 'native'}) ` +
        `to ${destinationAssetCode} (${destinationAssetIssuer}), amount: ${sourceAmount}`,
      );

      // Construct Stellar assets
      const sourceAsset = this.constructAsset(sourceAssetCode, sourceAssetIssuer);
      const destinationAsset = this.constructAsset(
        destinationAssetCode,
        destinationAssetIssuer,
      );

      // Query Stellar's path finding API
      const pathResponse = await this.horizonServer.strictReceivePaths([sourceAsset], destinationAsset, sourceAmount)
        .limit(1)
        .call();

      if (!pathResponse.records || pathResponse.records.length === 0) {
        this.logger.warn(
          `No paths found from ${sourceAssetCode} to ${destinationAssetCode}`,
        );
        // Return direct path with estimated rates as fallback
        return this.constructFallbackPath(
          sourceAsset,
          destinationAsset,
          sourceAmount,
        );
      }

      const pathRecord = pathResponse.records[0];
      return this.constructPaymentPath(
        sourceAsset,
        destinationAsset,
        sourceAmount,
        pathRecord,
      );
    } catch (error) {
      this.logger.error(
        `Error finding path: ${error.message}`,
        error.stack,
      );
      throw new Error(
        `Failed to find payment path: ${error.message}`,
      );
    }
  }

  /**
   * Find multiple alternative paths and rank them
   * 
   * @param sourceAssetCode - Code of the asset the user has
   * @param destinationAssetCode - Code of the asset needed
   * @param destinationAssetIssuer - Issuer of destination asset
   * @param sourceAmount - Amount to convert
   * @param pathCount - Number of alternative paths to find (default: 3)
   * @returns Analysis with best path and alternatives
   */
  async findBestRoutes(
    sourceAssetCode: string,
    destinationAssetCode: string,
    destinationAssetIssuer: string,
    sourceAmount: string,
    sourceAssetIssuer?: string,
    pathCount: number = 3,
  ): Promise<RouteAnalysis> {
    try {
      this.logger.debug(
        `Finding ${pathCount} alternative routes from ${sourceAssetCode} to ${destinationAssetCode}`,
      );

      const sourceAsset = this.constructAsset(sourceAssetCode, sourceAssetIssuer);
      const destinationAsset = this.constructAsset(
        destinationAssetCode,
        destinationAssetIssuer,
      );

      // Query multiple paths
      const pathResponse = await this.horizonServer.strictReceivePaths([sourceAsset], destinationAsset, sourceAmount)
        .limit(pathCount)
        .call();

      const paths: PaymentPath[] = [];

      if (pathResponse.records && pathResponse.records.length > 0) {
        for (const pathRecord of pathResponse.records) {
          paths.push(
            this.constructPaymentPath(
              sourceAsset,
              destinationAsset,
              sourceAmount,
              pathRecord,
            ),
          );
        }
      } else {
        // Fallback if no paths found
        paths.push(
          this.constructFallbackPath(sourceAsset, destinationAsset, sourceAmount),
        );
      }

      // Sort by fee percentage (ascending = best first)
      paths.sort((a, b) => a.estimatedFeePercentage - b.estimatedFeePercentage);

      const bestPath = paths[0];
      const alternativePaths = paths.slice(1);

      const metrics = {
        avgFeePercentage:
          paths.reduce((sum, p) => sum + p.estimatedFeePercentage, 0) /
          paths.length,
        bestConversionRate: Math.max(...paths.map((p) => p.conversionRate)),
        worstConversionRate: Math.min(...paths.map((p) => p.conversionRate)),
      };

      const recommendation =
        bestPath.estimatedFeePercentage < 1
          ? 'Use recommended path - excellent rates available'
          : bestPath.estimatedFeePercentage < 5
            ? 'Use recommended path - moderate fees'
            : 'Consider alternatives - high fees detected';

      return {
        bestPath,
        alternativePaths,
        recommendation,
        totalRoutingMetrics: metrics,
      };
    } catch (error) {
      this.logger.error(
        `Error finding routes: ${error.message}`,
        error.stack,
      );
      throw new Error(
        `Failed to find alternative routes: ${error.message}`,
      );
    }
  }

  /**
   * Analyze the cost of converting between two assets
   * Useful for showing users the impact of their asset choice
   * 
   * @param sourceAssetCode - Code of the asset user has
   * @param destinationAssetCode - Code of the asset needed
   * @param destinationAssetIssuer - Issuer of destination asset
   * @param sourceAmount - Amount to convert
   * @returns Cost analysis with fees and conversion details
   */
  async analyzeSwapcost(
    sourceAssetCode: string,
    destinationAssetCode: string,
    destinationAssetIssuer: string,
    sourceAmount: string,
    sourceAssetIssuer?: string,
  ): Promise<{
    sourceAsset: string;
    destinationAsset: string;
    inputAmount: string;
    outputAmount: string;
    feeAmount: string;
    feePercentage: number;
    conversionRate: number;
    recommendation: string;
  }> {
    try {
      const path = await this.findBestPath(
        sourceAssetCode,
        destinationAssetCode,
        destinationAssetIssuer,
        sourceAmount,
        sourceAssetIssuer,
      );

      return {
        sourceAsset: `${sourceAssetCode}${sourceAssetIssuer || ''}`,
        destinationAsset: `${destinationAssetCode}${destinationAssetIssuer}`,
        inputAmount: path.sourceAmount,
        outputAmount: path.destinationAmount,
        feeAmount: path.estimatedFeeAmount,
        feePercentage: path.estimatedFeePercentage,
        conversionRate: path.conversionRate,
        recommendation: this.generateRecommendation(path),
      };
    } catch (error) {
      this.logger.error(
        `Error analyzing swap cost: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Check if a direct swap is possible between two assets
   */
  async canSwap(
    sourceAssetCode: string,
    destinationAssetCode: string,
    destinationAssetIssuer: string,
    sourceAssetIssuer?: string,
  ): Promise<boolean> {
    try {
      const sourceAsset = this.constructAsset(sourceAssetCode, sourceAssetIssuer);
      const destinationAsset = this.constructAsset(
        destinationAssetCode,
        destinationAssetIssuer,
      );

      // Try to find any path
      const pathResponse = await this.horizonServer
        .strictReceivePaths([sourceAsset], destinationAsset, '1')
        .limit(1)
        .call();

      return pathResponse.records && pathResponse.records.length > 0;
    } catch (error) {
      this.logger.debug(
        `canSwap check failed: ${error.message} - assuming no direct swap available`,
      );
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Helper Methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Construct a Stellar Asset object
   */
  private constructAsset(code: string, issuer?: string): Asset {
    if (code === 'XLM' || !issuer) {
      return Asset.native();
    }
    return new Asset(code, issuer);
  }

  /**
   * Convert Horizon path response to PaymentPath
   */
  private constructPaymentPath(
    sourceAsset: Asset,
    destinationAsset: Asset,
    sourceAmount: string,
    pathRecord: any,
  ): PaymentPath {
    // destAmount comes from Horizon API
    const destinationAmount = pathRecord.destination_amount || sourceAmount;
    const receivedAmount = parseFloat(destinationAmount);
    const sentAmount = parseFloat(sourceAmount);

    // Calculate fees
    const feeAmount = sentAmount - receivedAmount;
    const feePercentage = (feeAmount / sentAmount) * 100;
    const conversionRate = receivedAmount / sentAmount;

    // Extract path steps
    const steps: PathStep[] = (pathRecord.path || []).map((asset: any) => ({
      asset: {
        code: asset.asset_code || 'XLM',
        issuer: asset.asset_issuer,
      },
    }));

    return {
      steps,
      sourceAsset: {
        code: sourceAsset.code || 'XLM',
        issuer: sourceAsset.issuer,
      },
      destinationAsset: {
        code: destinationAsset.code || 'XLM',
        issuer: destinationAsset.issuer,
      },
      sourceAmount,
      destinationAmount,
      estimatedFeePercentage: parseFloat(feePercentage.toFixed(6)),
      estimatedFeeAmount: feeAmount.toString(),
      conversionRate: parseFloat(conversionRate.toFixed(8)),
      hopCount: steps.length,
      executableImmediately: true,
      lastUpdated: new Date(),
    };
  }

  /**
   * Create a fallback path when no direct path is found
   * Uses estimated conversion rates
   */
  private constructFallbackPath(
    sourceAsset: Asset,
    destinationAsset: Asset,
    sourceAmount: string,
  ): PaymentPath {
    // Conservative estimate: 2% slip and fees for unknown paths
    const receivedAmount = (parseFloat(sourceAmount) * 0.98).toString();
    const feePercentage = 2.0;

    return {
      steps: [],
      sourceAsset: {
        code: sourceAsset.code || 'XLM',
        issuer: sourceAsset.issuer,
      },
      destinationAsset: {
        code: destinationAsset.code || 'XLM',
        issuer: destinationAsset.issuer,
      },
      sourceAmount,
      destinationAmount: receivedAmount,
      estimatedFeePercentage: feePercentage,
      estimatedFeeAmount: (parseFloat(sourceAmount) * (feePercentage / 100)).toString(),
      conversionRate: 0.98,
      hopCount: 0,
      executableImmediately: false,
      lastUpdated: new Date(),
    };
  }

  /**
   * Generate user-friendly recommendation based on path analysis
   */
  private generateRecommendation(path: PaymentPath): string {
    if (path.estimatedFeePercentage < 0.5) {
      return 'Excellent rate - execute immediately';
    } else if (path.estimatedFeePercentage < 1) {
      return 'Good rate - favorable for swapping';
    } else if (path.estimatedFeePercentage < 3) {
      return 'Moderate rate - acceptable for this asset pair';
    } else if (path.estimatedFeePercentage < 5) {
      return 'High fees - consider if truly necessary';
    } else {
      return 'Very high fees - seek alternative assets if possible';
    }
  }
}
