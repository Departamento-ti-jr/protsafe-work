import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AnsIntegrationService } from './ans-integration/ans-integration.service';
import { VaultModule } from 'src/vault/vault.module';
import { S3Module } from 'src/s3/s3.module';
import { DynamodbModule } from 'src/dynamodb/dynamodb.module';
import { SqsListenerModule } from 'src/sqs-listener/sqs-listener.module';
import { SqsSendService } from 'src/sqs-listener/sqs-send.service';

@Module({
  imports: [HttpModule, VaultModule, S3Module,  DynamodbModule], // 👈 aqui vai o MÓDULO
  providers: [AnsIntegrationService, SqsSendService],
  exports: [AnsIntegrationService],
})
export class AnsIntegrationModule {}