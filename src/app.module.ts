import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';  // importe aqui
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DefesaAnsModule } from './defesa-ans/defesa-ans.module';
import { SqsListenerModule } from './sqs-listener/sqs-listener.module';
import { AnsIntegrationModule } from './ans-integration/ans-integration.module';
import { S3Module } from './s3/s3.module';
import { VaultModule } from './vault/vault.module';
import { DynamodbModule } from './dynamodb/dynamodb.module';
import { SqsSendService } from './sqs-listener/sqs-send.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DefesaAnsModule,
    SqsListenerModule,
    AnsIntegrationModule,
    S3Module,
    VaultModule,
    DynamodbModule,
  ],
  controllers: [AppController],
  providers: [AppService, SqsSendService],
})
export class AppModule {}