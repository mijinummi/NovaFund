import { Injectable, Logger } from '@nestjs/common';
import { SorobanRpc, TransactionBuilder, Server, Keypair, Networks, Contract } from '@stellar/stellar-sdk';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KillSwitchService {
  private readonly logger = new Logger(KillSwitchService.name);
  private server = new Server('https://soroban-testnet.stellar.org');
  private rpc = new SorobanRpc.Server('https://soroban-testnet.stellar.org');

  constructor(private prisma: PrismaService) {}

  async pauseAllContracts(adminKeypair: Keypair): Promise<void> {
    try {
      this.logger.log('Initiating emergency pause for all core contracts');

      const contracts = await this.prisma.contract.findMany({
        where: { isCore: true }
      });

      const account = await this.server.getAccount(adminKeypair.publicKey());

      for (const contract of contracts) {
        await this.pauseContract(contract.id, account, adminKeypair);
      }

      this.logger.log('Emergency pause completed for all core contracts');
    } catch (error) {
      this.logger.error('Failed to pause contracts', error);
      throw error;
    }
  }

  private async pauseContract(contractId: string, account: any, keypair: Keypair): Promise<void> {
    try {
      const contract = new Contract(contractId);

      // Assume pause function exists
      const tx = new TransactionBuilder(account, {
        fee: '1000',
        networkPassphrase: Networks.TESTNET,
      })
      .addOperation(contract.call('pause'))
      .setTimeout(30)
      .build();

      tx.sign(keypair);

      // Simulate first
      const sim = await this.rpc.simulateTransaction(tx);
      if (sim.error) {
        throw new Error(`Simulation failed: ${sim.error}`);
      }

      // Submit
      const result = await this.rpc.sendTransaction(tx);
      this.logger.log(`Pause transaction submitted for contract ${contractId}: ${result.hash}`);
    } catch (error) {
      this.logger.error(`Failed to pause contract ${contractId}`, error);
      throw error;
    }
  }
}