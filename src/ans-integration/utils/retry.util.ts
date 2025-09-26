import { Logger } from '@nestjs/common';

export interface RetryOptions {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

export class RetryUtil {
  private static readonly logger = new Logger(RetryUtil.name);

  static async withRetry<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {},
    operationName = 'operation'
  ): Promise<T> {
    const config: RetryOptions = {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      backoffFactor: 2,
      ...options
    };

    let lastError: Error;
    let delay = config.initialDelay;

    for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
      try {
        const result = await operation();
        if (attempt > 1) {
          this.logger.log(`${operationName} succeeded on attempt ${attempt}`);
        }
        return result;
      } catch (error) {
        lastError = error as Error;
        
        if (attempt <= config.maxRetries) {
          this.logger.warn(
            `${operationName} failed on attempt ${attempt}/${config.maxRetries + 1}: ${error.message}. Retrying in ${delay}ms...`
          );
          
          await this.sleep(delay);
          delay = Math.min(delay * config.backoffFactor, config.maxDelay);
        }
      }
    }

    this.logger.error(`${operationName} failed after ${config.maxRetries + 1} attempts`);
    throw lastError!;
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}