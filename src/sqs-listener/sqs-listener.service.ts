import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { AnsIntegrationService } from 'src/ans-integration/ans-integration/ans-integration.service';
import { S3Service } from '../s3/s3.service';

@Injectable()
export class SqsListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsListenerService.name);
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;
  private polling = false;

  constructor(private readonly configService: ConfigService, private readonly ansIntegration: AnsIntegrationService, private readonly s3Service: S3Service) {
    const queueUrl = this.configService.get<string>('AWS_SQS_QUEUE_URL');
    if (!queueUrl) {
      throw new Error('AWS_SQS_QUEUE_URL is not defined');
    }
    this.queueUrl = queueUrl;

    this.sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }


  async onModuleInit() {
    this.logger.log('Iniciando escuta da fila SQS...');
    this.polling = true;
    this.pollMessages();
  }

  async onModuleDestroy() {
    this.logger.log('Parando escuta da fila SQS...');
    this.polling = false;
  }

  private async pollMessages() {
    while (this.polling) {
      const start = Date.now();
      //this.logger.debug('Início de um ciclo de polling na fila SQS.');

      try {
        const command = new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 5,
          WaitTimeSeconds: 10, // long polling
          VisibilityTimeout: 30, // tempo para processar antes de reaparecer
        });

        const response = await this.sqsClient.send(command);

        if (response.Messages && response.Messages.length > 0) {
          this.logger.log(`Recebidas ${response.Messages.length} mensagens do SQS.`);

          for (const message of response.Messages) {
            this.logger.log(`Mensagem recebida: ${message.Body}`);

            try {
              // Processa a mensagem e só deleta se for bem-sucedido
              const protocoloData = await this.ansIntegration.enviarImpugnacao(JSON.parse(message.Body!));
              const protocolQueueUrl = process.env.AWS_SQS_PROTOCOL_QUEUE_URL!;
              // Se chegou até aqui, o processamento foi bem-sucedido
              this.logger.log(`Processamento bem-sucedido. Protocolo ANS: ${JSON.stringify(protocoloData)}`);

              await this.sendMessage(
                process.env.AWS_SQS_PROTOCOL_QUEUE_URL!,
                protocoloData
              );

              if (message.ReceiptHandle) {
                await this.deleteMessage(message.ReceiptHandle);
              }
            } catch (processError) {
              this.logger.error(`Erro ao processar mensagem: ${processError.message}`, processError.stack);
              this.logger.warn('Mensagem não será deletada do SQS devido ao erro no processamento');
              // Não deleta a mensagem em caso de erro - ela ficará disponível para reprocessamento
            }
          }
        } else {
          //this.logger.debug('Nenhuma mensagem recebida neste ciclo de polling.');
        }
      } catch (error) {
        this.logger.error('Erro ao receber mensagem do SQS:', error.stack || error);
      }

      const elapsed = Date.now() - start;
      // this.logger.debug(`Fim do ciclo de polling (duração: ${elapsed}ms).`);
    }
  }

  private async deleteMessage(receiptHandle: string) {
    const deleteCommand = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    });

    await this.sqsClient.send(deleteCommand);
    this.logger.log('Mensagem deletada da fila com sucesso.');
  }

  private async sendMessage(queueUrl: string, payload: any): Promise<void> {
    const messageBody = JSON.stringify(payload);

    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: messageBody,
    });

    try {
      await this.sqsClient.send(command);
      this.logger.log(`Mensagem enviada para SQS (${queueUrl})`);
    } catch (error) {
      this.logger.error(`Erro ao enviar mensagem para SQS (${queueUrl}):`, error);
      throw error;
    }
  }

}