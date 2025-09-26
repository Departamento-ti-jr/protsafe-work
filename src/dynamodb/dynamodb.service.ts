// dynamodb.service.ts
import { Injectable } from '@nestjs/common';
import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

@Injectable()
export class DynamoDbService {
    private client: DynamoDBClient;

    constructor() {
        this.client = new DynamoDBClient({ region: 'us-east-1' }); // ajuste sua região
    }
    /*
      async getItemByPkSk(pk: string, sk: string) {
        const command = new GetItemCommand({
          TableName: 'contador', // troque pelo nome da sua tabela
          Key: {
            PK: { S: pk },
            SK: { S: sk },
          },
        });
    
        const response = await this.client.send(command);
    
        if (!response.Item) {
          return null; // não encontrou
        }
    
        // Converte de formato DynamoDB para objeto JS
        return unmarshall(response.Item);
      }
    */
      
      async getItemsByPk(pk: number) {
        const command = new QueryCommand({
          TableName: "contador",
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: {
            ":pk": { S: pk.toString() }, // converte number para string mas envia como N
          },
        });
      
        const response = await this.client.send(command);
      
        return response.Items?.map((item) => unmarshall(item)) || [];
      }
}