import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { S3Service } from './s3.service';

@Module({
  imports: [ConfigModule], // para usar o ConfigService
  providers: [S3Service],
  exports: [S3Service],     // exporta para poder usar em outros módulos
})
export class S3Module {}