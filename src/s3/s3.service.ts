import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import { promisify } from 'util';
import { pipeline, Readable } from 'stream';

const streamPipeline = promisify(pipeline);

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private s3: S3Client;
  private bucket: string;

  constructor(private configService: ConfigService) {
    /* this.s3 = new S3Client({
       region: 'us-east-1',
       endpoint: 'http://localhost:4566', // LocalStack
       credentials: {
         accessKeyId: 'test',
         secretAccessKey: 'test',
       },
       forcePathStyle: true,
     });
 */
    this.s3 = new S3Client({
      region: configService.get<string>('AWS_REGION'),
      credentials: {
        accessKeyId: configService.get<string>('AWS_ACCESS_KEY_ID')!,
        secretAccessKey: configService.get<string>('AWS_SECRET_ACCESS_KEY')!,
      },
    });
    this.bucket = this.configService.get<string>('AWS_BUCKET_NAME')!;
  }

  async uploadFile(localFilePath: string, idDefesa: number, fileName: string): Promise<string> {
    const key = `uploads/${idDefesa}/${fileName}`;
    const fileStream = fs.createReadStream(localFilePath);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: fileStream,
      ContentType: 'application/docx',
    });

    await this.s3.send(command);
    this.logger.log(`Arquivo enviado para S3: ${key}`);
    return `https://${this.bucket}.s3.amazonaws.com/${key}`;
  }

  async uploadFileByBuffer(buffer: Buffer, rootPath: string | number, fileName: string): Promise<string> {
    const key = `uploads/${rootPath}/${fileName}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: 'application/pdf',
    });

    await this.s3.send(command);
    this.logger.log(`Arquivo enviado para S3: ${key}`);
    return `https://${this.bucket}.s3.amazonaws.com/${key}`;
  }

  async downloadFile(key: string, downloadPath: string): Promise<void> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const response = await this.s3.send(command);

    if (!response.Body) throw new Error(`Arquivo ${key} não encontrado no S3`);

    const writeStream = fs.createWriteStream(downloadPath);
    await streamPipeline(response.Body as NodeJS.ReadableStream, writeStream);

    this.logger.log(`Arquivo baixado do S3: ${key} → ${downloadPath}`);
  }

  async downloadAsBuffer(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const response = await this.s3.send(command);
    this.logger.log(`Arquivo ${key} baixado do S3 (em memória)`);

    if (!response.Body || !(response.Body instanceof Readable))
      throw new Error(`Arquivo ${key} não encontrado ou inválido`);

    const chunks: Buffer[] = [];
    for await (const chunk of response.Body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const result = Buffer.concat(chunks);
    this.logger.log(`Arquivo ${key} baixado do S3 (em memória, ${result.length} bytes)`);
    return result;
  }

  async uploadFromBuffer(key: string, buffer: Buffer, contentType = 'application/octet-stream'): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    try {
      const region = this.configService.get<string>('AWS_REGION');
      await this.s3.send(command);
      this.logger.log(`Arquivo ${key} enviado para o S3 (${buffer.length} bytes)`);

      return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
    } catch (error) {
      this.logger.error(`Erro ao enviar arquivo ${key} para o S3: ${error.message}`, error.stack);
      throw new Error(`Falha ao fazer upload do arquivo ${key}`);
    }
  }

  // 🔹 Novo método para listar arquivos
  async listFiles(
    prefix?: string,
    contains?: string, // substring para filtrar no nome do arquivo
  ): Promise<{ Key: string; Size: number; LastModified: Date }[]> {
    const command = new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix });
    try {
      const response = await this.s3.send(command);
      if (!response.Contents) return [];

      let files = response.Contents.map(item => ({
        Key: item.Key!,
        Size: item.Size!,
        LastModified: item.LastModified!,
      }));

      if (contains) {
        files = files.filter(file => file.Key.includes(contains));
      }

      return files;
    } catch (error) {
      this.logger.error(`Erro ao listar arquivos no bucket ${this.bucket}: ${error.message}`, error.stack);
      throw new Error('Falha ao listar arquivos do S3');
    }
  }
}