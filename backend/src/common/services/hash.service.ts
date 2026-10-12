import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

/** Plain text the dummy comparison hashes; its value is never used. */
const DUMMY_COMPARISON_INPUT = 'dummy-comparison-input';

@Injectable()
export class HashService implements OnModuleInit {
  private readonly rounds: number;
  private dummyHash?: Promise<string>;

  constructor(private readonly configService: ConfigService) {
    this.rounds = this.configService.get<number>('bcrypt.rounds', 10);
  }

  async onModuleInit(): Promise<void> {
    await this.getDummyHash();
  }

  /**
   * Hash a plain text string using bcrypt
   * @param plainText - The plain text to hash
   * @returns Promise resolving to the hashed string
   */
  async hash(plainText: string): Promise<string> {
    return bcrypt.hash(plainText, this.rounds);
  }

  /**
   * Compare a plain text string against a hash
   * @param plainText - The plain text to compare
   * @param hash - The hash to compare against
   * @returns Promise resolving to true if match, false otherwise
   */
  async compare(plainText: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plainText, hash);
  }

  /**
   * Spend one bcrypt comparison and discard the result.
   *
   * A code step that finds no usable record runs this against a fixed dummy
   * hash made before the server starts with the same rounds as a real hash,
   * so the first answer costs one comparison like the answers after it.
   *
   * @param plainText - Value to compare, from the request
   */
  async spendComparison(plainText: string): Promise<void> {
    const dummyHash = await this.getDummyHash();
    await this.compare(plainText, dummyHash);
  }

  /**
   * The dummy hash, warmed at startup and reused. A failed attempt clears the
   * cache so the next call tries again instead of caching the rejection.
   */
  private getDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = this.hash(DUMMY_COMPARISON_INPUT).catch(
        (error: unknown) => {
          this.dummyHash = undefined;
          throw error;
        },
      );
    }
    return this.dummyHash;
  }
}
