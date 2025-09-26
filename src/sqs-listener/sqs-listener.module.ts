import { Module } from '@nestjs/common';
import { SqsListenerService } from './sqs-listener.service';

// Importa o módulo AnsIntegration
import { AnsIntegrationModule } from '../ans-integration/ans-integration.module';
import { S3Module } from 'src/s3/s3.module';

@Module({
  imports: [
    AnsIntegrationModule,
    S3Module
  ],
  providers: [SqsListenerService],
  exports: [SqsListenerService],
})
export class SqsListenerModule {}