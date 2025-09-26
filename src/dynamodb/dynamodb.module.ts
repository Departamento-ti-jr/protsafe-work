import { Module } from '@nestjs/common';
import { DynamoDbService } from './dynamodb.service';

@Module({
  providers: [DynamoDbService],
  exports: [DynamoDbService], // 👈 exporta para outros módulos
})
export class DynamodbModule {}