import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);
  private client: AxiosInstance;
  private readonly vaultToken: string;
  private readonly vaultUrl: string;

  constructor(private configService: ConfigService) {
    this.vaultUrl = this.configService.get<string>('VAULT_URL') || 'http://localhost:8200';
    this.vaultToken = this.configService.get<string>('VAULT_TOKEN') || '';
    
    this.client = axios.create({
      baseURL: this.vaultUrl,
      headers: {
        'X-Vault-Token': this.vaultToken,
      },
    });
  }

  /**
   * Lê um segredo KV v2 do Vault
   * @param path Caminho do segredo no Vault (ex: secret/data/myapp)
   */
  async getSecret(path: string): Promise<any> {
    try {
      const response = await this.client.get(`/v1/secret/data/${path}`);
      // KV v2 -> segredo está em data.data
      return response.data?.data?.data || null;
    } catch (error) {
      this.logger.error(`Erro ao buscar segredo no Vault: ${error.message}`);
      throw new Error(`Falha ao buscar segredo no Vault: ${path}`);
    }
  }

  /**
   * Escreve um segredo KV v2 no Vault
   * @param path Caminho do segredo no Vault (ex: secret/data/myapp)
   * @param data Dados a serem salvos
   */
  async setSecret(path: string, data: Record<string, any>): Promise<void> {
    try {
      await this.client.post(`/v1/${path}`, { data });
      this.logger.log(`Segredo salvo no Vault: ${path}`);
    } catch (error) {
      this.logger.error(`Erro ao salvar segredo no Vault: ${error.message}`);
      throw new Error(`Falha ao salvar segredo no Vault: ${path}`);
    }
  }
}