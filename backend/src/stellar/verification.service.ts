import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(private prisma: PrismaService) {}

  async verifyContract(contractId: string, gitUrl: string, deployedHash: string): Promise<boolean> {
    try {
      this.logger.log(`Starting verification for contract ${contractId}`);

      // Create temp directory
      const tempDir = `/tmp/verification-${contractId}-${Date.now()}`;
      await fs.mkdir(tempDir, { recursive: true });

      // Clone repository
      await this.execCmd(`git clone ${gitUrl} ${tempDir}`, tempDir);

      // Build contract
      await this.execCmd('soroban contract build', tempDir);

      // Read built wasm
      const wasmPath = `${tempDir}/target/wasm32-unknown-unknown/release/contract.wasm`;
      const builtWasm = await fs.readFile(wasmPath);

      // Calculate hash
      const builtHash = this.calculateHash(builtWasm);

      // Compare hashes
      const verified = builtHash === deployedHash;

      // Update database
      await this.prisma.contract.update({
        where: { id: contractId },
        data: { verified, verifiedAt: new Date() },
      });

      this.logger.log(`Contract ${contractId} verification: ${verified ? 'PASSED' : 'FAILED'}`);

      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });

      return verified;
    } catch (error) {
      this.logger.error(`Verification failed for contract ${contractId}`, error);
      return false;
    }
  }

  private async execCmd(command: string, cwd?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      exec(command, { cwd }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Command failed: ${command}\n${stderr}`));
        } else {
          resolve();
        }
      });
    });
  }

  private calculateHash(data: Buffer): string {
    // Use SHA-256 for proper hashing
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}