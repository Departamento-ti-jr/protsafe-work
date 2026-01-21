import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, retry, throwError, timer } from 'rxjs';
import { VaultService } from 'src/vault/vault.service';
import axios, { AxiosError } from 'axios';
import { ConfigService } from '@nestjs/config';
import * as qs from 'qs';
import { S3Service } from 'src/s3/s3.service';

import { DynamoDbService } from 'src/dynamodb/dynamodb.service';
import { SqsSendService } from 'src/sqs-listener/sqs-send.service';
import { createHash } from 'crypto';
import { DefesaSqsMessageDto } from 'src/defesa-ans/dto/defesa-sqs-message.dto/defesa-sqs-message.dto';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';


interface DocumentAdditional {
    documentName: string;
    documentType: string;
}

@Injectable()
export class AnsIntegrationService {
    private readonly logger = new Logger(AnsIntegrationService.name);
    private readonly baseUrl: string;

    constructor(
        private readonly httpService: HttpService,
        private readonly vaultService: VaultService,
        private readonly configService: ConfigService,
        private readonly dynamoDbService: DynamoDbService,
        private readonly s3Service: S3Service,
        private readonly sqsService: SqsSendService
    ) {
        this.baseUrl = this.configService.get<string>('ANS_BASE_URL') || 'https://www.ans.gov.br';
    }

    async enviarImpugnacao(
        defesaMessage: DefesaSqsMessageDto,
    ): Promise<any> {
        const returnResult: any = {};
        returnResult.id = defesaMessage.id;
        this.logger.log(
            `Iniciando processamento de impugnação ANS`,
            JSON.stringify(defesaMessage),
        );
        const dto = plainToInstance(DefesaSqsMessageDto, defesaMessage, {
            enableImplicitConversion: true,
        });
        console.log(dto.ansRegister)
        // 2️⃣ Validação
        await validateOrReject(dto, {
            whitelist: true,
            forbidNonWhitelisted: true,
        });

        const operadora = defesaMessage.registroAns;
        const numeroABI = defesaMessage.numeroAbi;
        const registroAns = defesaMessage.ansRegister;
        const tipoPeticao = defesaMessage.tipoDefesa === "IMPUGNACAO" ? "impugnacoes" : "recursos";


        // 01 - listar aquivos adicionais
        const caminhoDocumentosCompletares = defesaMessage.s3PathDocAdicional;

        // //02 - pegar credencial da ans
        console.log(operadora)
        const credentialAns = await this.vaultService.getSecret(operadora);
        const scope = 'br.gov.ans.eprotocolo.operadora br.gov.ans.eprotocolo.operadoras.notificacoes.r br.gov.ans.eprotocolo.operadoras.peticoes br.gov.ans.eprotocolo.operadoras.peticoes.r'
        // console.log(credentialAns);

        // 03 - PEGAR O DOCUMENTO DO S3 principal
        //const docPrincipal = defesaMessage.s3PdfPath;
        // const docsAdditional = defesaMessage.s3PathDocAdicional;

        // Token autorização ANS
        this.logger.log('Solicitando token de autorização OAuth2 da ANS...');
        const accessToken = await this.authorizationToken(scope, credentialAns.client_id, credentialAns.client_secret);
        //const accessToken = await this.authorizationToken(scope, '2509.apps.ans.gov.br', '4dxkwjcizj0312r');

        const bearerToken = accessToken.access_token;
        //this.logger.log('OAuth2 da ANS...', accessToken);

        const [dia, mes, ano] = defesaMessage.dataFinal.split('/');
        const dataFimAtendimento = `${dia.padStart(2, '0')}-${mes.padStart(2, '0')}-${ano}`;
        this.logger.log('Data fim atendimento: ', dataFimAtendimento);

        // //05 - 
        //this.converterToBodyPeticao(); 
        const payloadEnvioAns = {
            numeroProcesso: defesaMessage.numeroProcesso.replace(/[^a-zA-Z0-9]/g, ''),
            informacoesAdicionais: {
                competenciaAtendimento: defesaMessage.competencia,
                dataFimAtendimento: dataFimAtendimento
                ,
                numeroAtendimento: defesaMessage.numeroAihApac
            }
        };
        this.logger.log('Data fim atendimento: ', payloadEnvioAns);

        // // Envio da petição para ANS
        this.logger.log(`Enviando petição ${tipoPeticao} para ANS - Registro: ${registroAns}`);

        //const protocoloId = await this.enviarPeticaoAns(JSON.stringify(payloadEnvioAns), bearerToken, registroAns, tipoPeticao);
        let protocoloId: string | undefined;

        try {
            this.logger.debug(`Chamando enviarPeticaoAns com payload: ${JSON.stringify(payloadEnvioAns)}`);
            protocoloId = await this.enviarPeticaoAns(
                JSON.stringify(payloadEnvioAns),
                bearerToken,
                registroAns,
                tipoPeticao
            );

            this.logger.log(`✅ Petição enviada com sucesso - Protocolo ANS: ${protocoloId}`);
        } catch (error: any) {
            this.logger.error(`❌ Erro ao enviar petição para ANS: ${error?.response?.status} - ${error?.response?.data?.mensagem || error.message}`);
            this.logger.error(`Detalhes completos do erro:`, error?.response?.data || error);
            returnResult.error = {
                status: error?.response?.status,
                message: 'Erro ao enviar petição para ANS',
                detalhe: error?.response?.data
            };
        }
        //await this.sqsService.sendMessage(protocolQueueUrl, { protocoloId: protocoloId, _id: body._id });


        // ## Envio do documento principal
        if (protocoloId) {
            returnResult.protocoloId = protocoloId;

            try {
                await this.addDocumentoPrincipal(
                    bearerToken,
                    registroAns,
                    protocoloId,
                    tipoPeticao,
                    defesaMessage
                );
            } catch (error: any) {
                returnResult.error = {
                    status: error?.response?.status,
                    message: 'Erro ao enviar documento principal para ANS',
                    detalhe: error?.response?.data
                };
            }
        }

        // ## Envio dos documentos complementares
        if (protocoloId && defesaMessage.s3PathDocAdicional?.length) {
            this.logger.log(`Enviando documentos complementares`);

            try {
                await this.addDocumentoComplementar(
                    bearerToken,
                    protocoloId,
                    tipoPeticao,
                    defesaMessage
                );
            } catch (error: any) {
                returnResult.error = {
                    status: error?.response?.status,
                    message: 'Erro ao enviar documentos complementares para ANS',
                    detalhe: error?.response?.data
                };
            }
        }

        this.logger.log(`Processo de envio para ANS concluído. Protocolo: ${protocoloId}${returnResult.error ? ' - COM ERROS' : ' - SUCESSO'}`);

        return returnResult;
    }


    /**
   * Obtém token de autorização OAuth2 da ANS
   * @param scope Scope da requisição
   * @param clientId Client ID
   * @param clientSecret Client Secret
   * @returns Objeto com token e informações retornadas
   */
    async authorizationToken(
        _scope: string,
        clientId: string,
        clientSecret: string,
    ): Promise<any> {
        const url = `${this.baseUrl}/oauth2/token?grant_type=client_credentials`;

        // o scope deve ser uma string separada por espaços
        const formData = qs.stringify({
            scope: "br.gov.ans.eprotocolo.operadora br.gov.ans.eprotocolo.operadoras.notificacoes.r br.gov.ans.eprotocolo.operadoras.peticoes br.gov.ans.eprotocolo.operadoras.peticoes.r",
        });

        const authHeader =
            'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

        try {
            const response = await axios.post(url, formData, {
                headers: {
                    Authorization: authHeader,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            });

            this.logger.log(`Token OAuth2 obtido com sucesso - Status: ${response.status}`);
            this.logger.debug(`Detalhes do token recebido: ${JSON.stringify(response.data)}`);
            return response.data;
        } catch (error: any) {
            this.logger.error(`Erro na requisição: ${error.message}`);
            if (error.response) {
                this.logger.error(`Status: ${error.response.status}`);
                this.logger.error(`Body: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }


    async enviarPeticaoAns(
        bodyPeticao: string,
        token: string,
        ansRegister: string,
        tipoPeticao: string,
    ): Promise<string> {
        const url = `https://www.ans.gov.br/e-protocolo/v2/operadoras/${ansRegister}/peticoes/ressarcimento/${tipoPeticao}`;
        
        this.logger.debug(`Iniciando enviarPeticaoAns para URL: ${url}`);

        try {
            const response = await firstValueFrom(
                this.httpService.post(url, bodyPeticao, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                    },
                    timeout: 15000,
                }),
            );

            const codigo = response.data?.codigo;

            if (!codigo) {
                throw new Error('ANS respondeu sem código de protocolo');
            }

            return codigo;
        } catch (error) {
            // 🚀 NÃO transforme o erro
            throw error;
        }
    }
    private extractAnsError(ansData: any) {
        if (!ansData) return 'Erro desconhecido retornado pela ANS';

        return {
            codigo: ansData.codigo ?? ansData.code,
            mensagem: ansData.mensagem ?? ansData.message,
            detalhes: ansData.detalhes ?? ansData.errors,
        };
    }
    async addDocumentoPrincipal(

        token: string,
        ansRegister: string,
        protocoloId: string,
        tipoPeticao: string,
        defesaMessage: DefesaSqsMessageDto
    ): Promise<void> {
        const fileNamePrincipal = defesaMessage.id;
        this.logger.log(`Iniciando upload do documento principal: ${fileNamePrincipal}`);
        const bufferPrincipal = await this.s3Service.downloadAsBufferByUrl(defesaMessage.s3PdfPath);
        const shar256Buffer = await this.generateSHA256(bufferPrincipal);
        const uint8Array = new Uint8Array(bufferPrincipal);
        const blob = new Blob([uint8Array], { type: 'application/pdf' });
        const formData = new FormData();
        formData.append('nomeArquivo', defesaMessage.id.toString() + ".pdf");
        formData.append('assunto', 'Impugnação referente ao atendimento');
        formData.append('arquivo', blob, "98_68aa31dda62633a127dbf80c.pdf");
        formData.append('hash', shar256Buffer);
        //   campo: 'hash',

        const url = `https://www.ans.gov.br/e-protocolo/v2/operadoras/${ansRegister}/peticoes/ressarcimento/${tipoPeticao}/${protocoloId}/documentos/principais`;

        await firstValueFrom(
            this.httpService.post(url, formData, {
                headers: {
                    //...formData.getHeaders(),
                    Authorization: `Bearer ${token}`,
                },
            }),
        );

        this.logger.log(`✅ Documento principal ${fileNamePrincipal} enviado com sucesso para ANS`);
    }

    async addDocumentoComplementar(
        token: string, protocoloId: string, tipoPeticao: string, defesaMessage: DefesaSqsMessageDto): Promise<void> {
        const documentAdditional = defesaMessage.s3PathDocAdicional ?? [];
        this.logger.log(`Iniciando envio de ${defesaMessage.s3PathDocAdicional?.length} documento(s) complementar(es) para ANS`);
        const requiredDocuments = defesaMessage.requiredDocsCount;
        const dataInclusao = defesaMessage.dataInclusao ?? ''
        for (const [index, doc] of documentAdditional.entries()) {
            try {

                const fileNameDocumentUpload = doc.id + ".pdf";
                this.logger.log(`📄 Processando documento complementar: ${JSON.stringify(doc)} - INDEX: ${index} - ${requiredDocuments}`);
                // normaliza a key para não dar NoSuchKey
                const bufferComplementar = await this.s3Service.downloadAsBufferByUrl(doc.url);

                const sha256Buffer = await this.generateSHA256(bufferComplementar);
                const uint8Array = new Uint8Array(bufferComplementar);
                const blob = new Blob([uint8Array], { type: 'application/pdf' });

                const formData = new FormData();
                formData.append('nomeArquivo', `${index + 1}_${requiredDocuments}_${doc.fileName}`);
                formData.append('assunto', 'Documento comprobatório');
                formData.append('tipoDocumento', '61'); // TODO: substituir valor fixo
                const dataDocumento = this.formatBrazilianDateToISO(dataInclusao);

                // Log detalhado da data
                this.logger.log(`📅 Processando data do documento ${fileNameDocumentUpload}:`, {
                    dataInclusaoOriginal: dataInclusao,
                    dataDocumentoFormatada: dataDocumento,
                    tipoConversao: dataInclusao ? 'Data brasileira (DD/MM/YYYY) convertida para ISO (YYYY-MM-DD)' : 'Data atual (inclusao ausente)'
                });

                formData.append('dataDocumento', dataDocumento);
                formData.append('arquivo', blob, fileNameDocumentUpload);
                formData.append('hash', doc.hash);

    
                const url = `https://www.ans.gov.br/e-protocolo/v2/operadoras/${defesaMessage.ansRegister}/peticoes/ressarcimento/${tipoPeticao}/${protocoloId}/documentos/complementares`;
                const response = await firstValueFrom(
                    this.httpService.post(url, formData, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }),
                );
                this.logger.log(`🆗 Documento complementar enviado com sucesso para ANS - Status: ${response.status}`);
            } catch (error: any) {
                this.logger.error(`Erro ao enviar documento complementar ${doc.fileName}: ${error.message}`);
                throw error;
            }
        }

        this.logger.log(`📌 Processamento concluído: ${documentAdditional.length} documento(s) complementar(es) enviado(s) para ANS`);
    }


    private formatBrazilianDateToISO(dateString: string): string {
        if (!dateString) {
            return new Date().toISOString().split('T')[0];
        }

        try {
            // Verifica se está no formato DD/MM/YYYY
            const brazilianDateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
            const match = dateString.match(brazilianDateRegex);

            if (match) {
                const [, day, month, year] = match;
                // Converte para formato ISO: YYYY-MM-DD
                const isoDate = `${year}-${month}-${day}`;
                this.logger.debug(`Data convertida: ${dateString} -> ${isoDate}`);
                return isoDate;
            }

            // Se não estiver no formato esperado, tenta conversão direta
            const date = new Date(dateString);
            if (!isNaN(date.getTime())) {
                const isoDate = date.toISOString().split('T')[0];
                this.logger.debug(`Data convertida (formato alternativo): ${dateString} -> ${isoDate}`);
                return isoDate;
            }

            throw new Error(`Formato de data não reconhecido: ${dateString}`);

        } catch (error) {
            this.logger.warn(`Erro ao converter data ${dateString}: ${error.message}. Usando data atual.`);
            return new Date().toISOString().split('T')[0];
        }
    }

    async generateSHA256(buffer: Buffer): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                const hash = createHash("sha256");
                hash.update(buffer);
                resolve(hash.digest("hex"));
            } catch (err) {
                reject(err);
            }
        });
    }
}