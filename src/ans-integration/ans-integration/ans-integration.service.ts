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
    ): Promise<string> {
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

        console.log(credentialAns);

        // 03 - PEGAR O DOCUMENTO DO S3 principal
        const docPrincipal = defesaMessage.s3PdfPath;
        const docsAdditional = defesaMessage.s3PathDocAdicional;
        // /const documentsAdicionais = [];
        // const documentsAns = {
        //     principal: S3PdfPath,
        //     adicionais: [] as string[]
        // }
        // // const documentsAdicionais = filesS3ToUploadAsns.map(arq => arq.Key);
        // // documentsAns.adicionais = documentsAdicionais;

        // Token autorização ANS
        this.logger.log('Solicitando token de autorização OAuth2 da ANS...');
        const accessToken = await this.authorizationToken(credentialAns.scope, credentialAns.client_id, credentialAns.client_secret);
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

        // const protocoloId = await this.enviarPeticaoAns(JSON.stringify(payloadEnvioAns), bearerToken, registroAns, tipoPeticao);

        // this.logger.log(`✅ Petição enviada com sucesso - Protocolo ANS: ${protocoloId}`);
        // await this.sqsService.sendMessage(protocolQueueUrl, { protocoloId: protocoloId, _id: body._id });
        

        //## Envio do documento principal
        // if (protocoloId) {
        //     await this.addDocumentoPrincipal(docPrincipal, bearerToken, registroAns, protocoloId, tipoPeticao);
        // }

        // Envio dos documentos complementares para ANS
        if (docsAdditional?.length) {
            for (const anexo of docsAdditional) {
                this.logger.log(`Iniciando upload do documento principal: ${anexo.url}`);
                const bufferPrincipal = await this.s3Service.downloadAsBufferByUrl(anexo.url);
                //await this.addDocumentoComplementar(bearerToken, documentAdditional, registroAns, protocoloId, tipoPeticao, body.inclusao, requiredDocsCount);
            }
        }

        // this.logger.log(`Processo de envio para ANS concluído com sucesso. Protocolo: ${protocoloId}`);

        // return protocoloId;
        return "";
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

        try {
            const response = await firstValueFrom(
                this.httpService
                    .post(url, bodyPeticao, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json',
                            Accept: 'application/json',
                        },
                        timeout: 15000,
                    })
                    .pipe(
                        retry({
                            count: 2,
                            delay: (error, retryCount) => {
                                const status = error?.response?.status;

                                // ❌ não retry para erros funcionais
                                if (status && status < 500) {
                                    throw error;
                                }

                                this.logger.warn(
                                    `Erro ANS. Retry ${retryCount} de 2`,
                                );

                                return timer(1000 * retryCount); // ✅ ObservableInput
                            },
                        }),
                    ),
            );

            const codigo = response.data?.codigo;
            if (!codigo) {
                throw new HttpException(
                    'Resposta da ANS não contém código do protocolo',
                    HttpStatus.BAD_GATEWAY,
                );
            }

            return codigo;
        } catch (err) {
            if (err instanceof AxiosError) {
                const status = err.response?.status ?? HttpStatus.SERVICE_UNAVAILABLE;

                throw new HttpException(
                    {
                        message: 'Erro ao comunicar com ANS',
                        ansStatus: status,
                        ansResponse: err.response?.data,
                    },
                    status,
                );
            }

            throw err;
        }
    }


    async addDocumentoPrincipal(
        fileNamePrincipal: string,
        token: string,
        ansRegister: string,
        protocoloId: string,
        tipoPeticao: string
    ): Promise<void> {
        this.logger.log(`Iniciando upload do documento principal: ${fileNamePrincipal}`);
        const bufferPrincipal = await this.s3Service.downloadAsBuffer(fileNamePrincipal);
        const shar256Buffer = await this.generateSHA256(bufferPrincipal);
        const uint8Array = new Uint8Array(bufferPrincipal);
        const blob = new Blob([uint8Array], { type: 'application/pdf' });
        const formData = new FormData();
        formData.append('nomeArquivo', fileNamePrincipal);
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
        token: string, documentAdditional: any[], ansRegister: string, protocoloId: string, tipoPeticao: string, inclusao: any, requiredDocsCount: any): Promise<void> {
        this.logger.log(`Iniciando envio de ${documentAdditional.length} documento(s) complementar(es) para ANS`);

        for (const [index, doc] of documentAdditional.entries()) {
            try {
                const fileNameDocumentUpload = doc.filename.match(/[^/]+$/);
                this.logger.log(`📄 Processando documento complementar: ${fileNameDocumentUpload} - INDEX: ${index} - ${requiredDocsCount}`);
                // normaliza a key para não dar NoSuchKey
                const key = doc.s3path.replace(/^\//, '');
                const bufferComplementar = await this.s3Service.downloadAsBuffer(key);

                const sha256Buffer = await this.generateSHA256(bufferComplementar);
                const uint8Array = new Uint8Array(bufferComplementar);
                const blob = new Blob([uint8Array], { type: 'application/pdf' });

                const formData = new FormData();
                formData.append('nomeArquivo', `${index + 1}_${requiredDocsCount}_${fileNameDocumentUpload}`);
                formData.append('assunto', 'Documento comprobatório');
                formData.append('tipoDocumento', '61'); // TODO: substituir valor fixo
                const dataDocumento = this.formatBrazilianDateToISO(inclusao);

                // Log detalhado da data
                this.logger.log(`📅 Processando data do documento ${doc.filename}:`, {
                    dataInclusaoOriginal: inclusao,
                    dataDocumentoFormatada: dataDocumento,
                    tipoConversao: inclusao ? 'Data brasileira (DD/MM/YYYY) convertida para ISO (YYYY-MM-DD)' : 'Data atual (inclusao ausente)'
                });

                formData.append('dataDocumento', dataDocumento);
                formData.append('arquivo', blob, doc.filename);
                formData.append('hash', sha256Buffer);

                // Log de todos os campos enviados no FormData
                /*this.logger.log(`📋 Campos enviados no FormData para ${doc.filename}:`, {
                    nomeArquivo: doc.filename,
                    assunto: 'Documento comprobatório',
                    tipoDocumento: '61',
                    dataDocumento: dataDocumento,
                    arquivoNome: doc.filename,
                    hash: sha256Buffer,
                    tamanhoArquivo: bufferComplementar.length + ' bytes'
                });*/

                const url = `https://www.ans.gov.br/e-protocolo/v2/operadoras/${ansRegister}/peticoes/ressarcimento/${tipoPeticao}/${protocoloId}/documentos/complementares`;

                // Log detalhado da requisição
                /* this.logger.debug('Enviando documento complementar para ANS', {
                     url,
                     filename: doc.filename,
                     s3path: doc.s3path,
                     fileSize: bufferComplementar.length,
                     hash: sha256Buffer,
                     ansRegister,
                     protocoloId,
                     tipoPeticao
                 });*/

                const response = await firstValueFrom(
                    this.httpService.post(url, formData, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }),
                );

                /* Log da resposta de sucesso
                this.logger.debug('Resposta ANS para documento complementar', {
                    status: response.status,
                    //statusText: response.statusText,
                    //data: JSON.stringify(response.data),
                    //headers: JSON.stringify(response.headers)
                });*/

                this.logger.log(`🆗 Documento complementar ${fileNameDocumentUpload} enviado com sucesso para ANS - Status: ${response.status}`);
            } catch (error: any) {
                const status = error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR;
                const responseData = error?.response?.data;
                const responseHeaders = error?.response?.headers;
                const serverMessage = responseData?.message || error.message || 'Erro desconhecido';
                const timestamp = responseData?.timestamp || new Date().toISOString();

                // Log detalhado do erro da ANS
                this.logger.error(`❌ Erro ao enviar documento ${doc.filename}`, {
                    status,
                    url: error?.config?.url,
                    method: error?.config?.method,
                    responseData: JSON.stringify(responseData),
                    responseHeaders: JSON.stringify(responseHeaders),
                    requestHeaders: JSON.stringify(error?.config?.headers),
                    filename: doc.filename,
                    s3path: doc.s3path,
                    timestamp
                });

                // Log adicional para debug
                this.logger.debug('Detalhes completos do erro ANS', {
                    errorMessage: error.message,
                    errorCode: error.code,
                    fullResponse: error.response ? {
                        status: error.response.status,
                        statusText: error.response.statusText,
                        data: error.response.data,
                        headers: error.response.headers
                    } : 'No response object'
                });

                // relança para o controller tratar se necessário
                throw new HttpException(
                    {
                        message: `Falha ao enviar documento ${doc.filename}`,
                        detalhe: serverMessage,
                        responseData,
                        timestamp,
                    },
                    status,
                );
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