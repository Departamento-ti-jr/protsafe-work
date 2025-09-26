import { Injectable, Logger } from '@nestjs/common';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

@Injectable()
export class SqsSendService {
    private readonly logger = new Logger(SqsSendService.name);
    private readonly client: SQSClient;

    constructor() {
        this.client = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
    }

    async sendMessage(queueUrl: string, payload: any): Promise<void> {
        const messageBody = JSON.stringify(payload);

        const command = new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: messageBody,
        });

        try {
            await this.client.send(command);
            this.logger.log(`Mensagem enviada para SQS (${queueUrl})`);
        } catch (error) {
            this.logger.error(`Erro ao enviar mensagem para SQS (${queueUrl}):`, error);
            throw error;
        }
    }
}