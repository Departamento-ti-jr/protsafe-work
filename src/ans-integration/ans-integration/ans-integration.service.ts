import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { VaultService } from 'src/vault/vault.service';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import * as qs from 'qs';
import { S3Service } from 'src/s3/s3.service';

import { DynamoDbService } from 'src/dynamodb/dynamodb.service';
import { SqsSendService } from 'src/sqs-listener/sqs-send.service';
import { createHash } from 'crypto';


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

    async enviarImpugnacao(body: any): Promise<string> {
        if (!body) {
            throw new Error("Mensagem SQS inválida: body está vazio ou undefined");
        }

        this.logger.log(`Iniciando processamento de impugnação ANS - Tipo do body: ${typeof (body)}`);
        const operadora = body.operadora;
        const numeroABI = body.numeroABI;
        const ordem = body.ordem;
        //01 - listar aquivos do s3
        const caminhoDocumentosCompletares = `uploads/${numeroABI}/${ordem}`;
        this.logger.log(`Definindo caminho para documentos complementares: ${caminhoDocumentosCompletares}`);
        //const filesS3ToUploadAsns = await this.s3Service.listFiles(caminhoDocumentosCompletares)
        //console.log("files" + JSON.stringify(filesS3ToUploadAsns))
        //02 - pegar credencial da ans
        const credentialAns = await this.vaultService.getSecret(operadora.ansRegister);
        //console.log(credentialAns);
        // console.log(accessToken);
        //02 - PEGAR OS DOCUMENTOS DO S3 principal
        const S3PdfPath = body.S3PdfPath;
        //documentos adicionais dynamo - temporarily disabled due to AWS permissions
        this.logger.log(`Preparando consulta ao DynamoDB para ordem: ${ordem}`);


        //const documentsAdicionais = [];
        const documentsAns = {
            principal: S3PdfPath,
            adicionais: [] as string[]
        }
        // const documentsAdicionais = filesS3ToUploadAsns.map(arq => arq.Key);
        // documentsAns.adicionais = documentsAdicionais;

        this.logger.log(`Documentos preparados para envio à ANS: Principal=${documentsAns.principal}, Adicionais=${documentsAns.adicionais.length} arquivo(s)`);

        this.logger.log('Solicitando token de autorização OAuth2 da ANS...');
        const accessToken = await this.authorizationToken(credentialAns.scope, credentialAns.client_id, credentialAns.client_secret);

        //05 - 
        //this.converterToBodyPeticao(); 
        const payload = {
            numeroProcesso: body.numeroProcesso.replace(/[^a-zA-Z0-9]/g, ''),
            informacoesAdicionais: {
                competenciaAtendimento: body.comp,
                dataFimAtendimento: `${new Date(body.dataFinal).getDate().toString().padStart(2, '0')}-${(new Date(body.dataFinal).getMonth() + 1).toString().padStart(2, '0')}-${new Date(body.dataFinal).getFullYear()}`
                ,
                numeroAtendimento: body.numeroAihApac
            }
        };
        this.logger.log(`Payload da petição preparado: Processo=${payload.numeroProcesso}, Competência=${payload.informacoesAdicionais.competenciaAtendimento}, Atendimento=${payload.informacoesAdicionais.numeroAtendimento}`);
        //04 - enviar 
        const bearerToken = accessToken.access_token;
        const tipoPeticao = "recursos"; //pegar dinamico

        const registroAns = body.registroAns;

        // Envio da petição para ANS
        this.logger.log(`Enviando petição ${tipoPeticao} para ANS - Registro: ${registroAns}`);
        const protocoloId = "254641454545"//await this.enviarPeticaoAns(JSON.stringify(payload), bearerToken, registroAns, tipoPeticao);
        this.logger.log(`✅ Petição enviada com sucesso - Protocolo ANS: ${protocoloId}`);
        //AWS_SQS_PROTOCOL_QUEUE_URL
        const protocolQueueUrl = process.env.AWS_SQS_PROTOCOL_QUEUE_URL;
        if (!protocolQueueUrl) {
            throw new Error('AWS_SQS_PROTOCOL_QUEUE_URL environment variable is not set');
        }
        this.logger.log(`Enviando protocolo ${protocoloId} para fila de processamento MongoDB via SQS`);
        await this.sqsService.sendMessage(protocolQueueUrl, { protocoloId: protocoloId, _id: body._id });

        this.logger.log(`Iniciando envio de documentos para protocolo ${protocoloId}`);

        // Envio do documento principal
        if (S3PdfPath) {
            this.logger.log(`Enviando documento principal: ${S3PdfPath}`);
            //await this.addDocumentoPrincipal(S3PdfPath, bearerToken, registroAns, protocoloId, tipoPeticao);
        } else {
            this.logger.warn('Nenhum documento principal especificado para envio');
        }

        // Consulta documentos adicionais no DynamoDB
        this.logger.log(`Consultando documentos adicionais no DynamoDB para ordem: ${ordem}`);
        let documentAdditional: any[] = [];

        try {
            documentAdditional = await this.dynamoDbService.getItemsByPk(ordem);
            this.logger.log(`✅ Consulta DynamoDB concluída: ${documentAdditional.length} documento(s) adicional(is) encontrado(s)`);

            if (documentAdditional.length > 0) {
                this.logger.debug(`Documentos encontrados: ${JSON.stringify(documentAdditional.map(doc => ({ filename: doc.filename, s3path: doc.s3path })))}`);
            }
        } catch (error) {
            this.logger.error(`❌ Erro ao consultar DynamoDB para ordem ${ordem}: ${error.message}`);
            this.logger.warn('Continuando processamento sem documentos adicionais');
            documentAdditional = []; // fallback para array vazio em caso de erro
        }

        // Envio dos documentos complementares para ANS
        if (documentAdditional.length > 0) {
            //await this.addDocumentoComplementar(bearerToken, documentAdditional, registroAns, protocoloId, tipoPeticao);
        } else {
            this.logger.log('Nenhum documento complementar para enviar à ANS');
        }

        this.logger.log(`Processo de envio para ANS concluído com sucesso. Protocolo: ${protocoloId}`);

        return protocoloId;
        /*

        const payload = [{
            numeroProcesso: "33910028464202533",
            informacoesAdicionais: {
                competenciaAtendimento: "0524",
                dataFimAtendimento: "31-05-2024",
                numeroAtendimento: 242429660
            }
        }];

        try {
            // firstValueFrom converte Observable para Promise
            const response = await firstValueFrom(
                this.httpService.post(url, payload, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }),
            );
            console.log('Resposta ANS:', response.data);
            return response.data;
        } catch (error) {
            console.error('Erro na chamada ANS:', error.response?.data || error.message);
            throw error;
        }*/
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
        try {
            this.logger.log(`Enviando Petição ANS: ${tipoPeticao}`);

            const url = `https://www.ans.gov.br/e-protocolo/v2/operadoras/${ansRegister}/peticoes/ressarcimento/${tipoPeticao}`;

            // Monta o curl para debug
            const curlCmd = `
    curl -X POST "${url}" \\
      -H "Authorization: Bearer ${token}" \\
      -H "Content-Type: application/json" \\
      -d '${bodyPeticao}'
            `.trim();

            this.logger.debug(`cURL equivalente:\n${curlCmd}`);

            this.logger.debug(`Request URL: ${url}`);
            this.logger.debug(`Request Body: ${bodyPeticao}`);

            const response = await firstValueFrom(
                this.httpService.post(url, bodyPeticao, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                }),
            );

            this.logger.log(`Response Status: ${response.status}`);
            this.logger.log(`Response Headers: ${JSON.stringify(response.headers)}`);
            this.logger.log(`Response Body: ${JSON.stringify(response.data)}`);

            const codigo = response.data.codigo; // pega o campo "codigo" do JSON
            if (!codigo) {
                throw new Error('Resposta da ANS não contém código do protocolo');
            }
            return codigo;
        } catch (error) {
            // log detalhado
            this.logger.error(
                `Falha ao enviar petição: ${error.response?.status} - ${JSON.stringify(error.response?.data)}`,
            );

            // Lança exceção para que o SQS não delete a mensagem
            throw new Error(`Falha ao enviar petição para ANS: ${error.message}`);
        }
    }

    /* converterToBodyPeticao(defense: Defense): string {
         const protocoloObject = {
             numeroProcesso: defense.processNumber.replace(/[^a-zA-Z0-9]/g, ''),
             informacoesAdicionais: {
                 competenciaAtendimento: defense.competence,
                 dataFimAtendimento: defense.endDateAttendance,
                 numeroAtendimento: Number(defense.numeroAtendimento),
             },
         };
 
         // JSON.stringify com identação opcional
         return JSON.stringify(protocoloObject, null, 2);
     }*/

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
        token: string,
        documentAdditional: any[],
        ansRegister: string,
        protocoloId: string,
        tipoPeticao: string
    ): Promise<void> {
        this.logger.log(`Iniciando envio de ${documentAdditional.length} documento(s) complementar(es) para ANS`);

        for (const doc of documentAdditional) {
            try {
                this.logger.log(`📄 Processando documento complementar: ${doc.filename}`);

                // normaliza a key para não dar NoSuchKey
                const key = doc.s3path.replace(/^\//, '');
                const bufferComplementar = await this.s3Service.downloadAsBuffer(key);

                const sha256Buffer = await this.generateSHA256(bufferComplementar);
                const uint8Array = new Uint8Array(bufferComplementar);
                const blob = new Blob([uint8Array], { type: 'application/pdf' });

                const formData = new FormData();
                formData.append('nomeArquivo', doc.filename);
                formData.append('assunto', 'Documento comprobatório');
                formData.append('tipoDocumento', '6'); // TODO: substituir valor fixo
                formData.append('dataDocumento', new Date().toISOString().split('T')[0]);
                formData.append('arquivo', blob, doc.filename);
                formData.append('hash', sha256Buffer);

                const url = `https://www.ans.gov.br/e-protocolo/v2/operadoras/${ansRegister}/peticoes/ressarcimento/${tipoPeticao}/${protocoloId}/documentos/complementares`;

                await firstValueFrom(
                    this.httpService.post(url, formData, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }),
                );

                this.logger.log(`✅ Documento complementar ${doc.filename} enviado com sucesso para ANS`);
            } catch (error: any) {
                const status = error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR;
                const serverMessage = error?.response?.data?.message || error.message || 'Erro desconhecido';
                const timestamp = error?.response?.data?.timestamp || new Date().toISOString();

                this.logger.error(
                    `❌ Erro ao enviar documento ${doc.filename} | Status: ${status} | Data: ${timestamp} | Detalhe: ${serverMessage}`,
                );

                // relança para o controller tratar se necessário
                throw new HttpException(
                    {
                        message: `Falha ao enviar documento ${doc.filename}`,
                        detalhe: serverMessage,
                        timestamp,
                    },
                    status,
                );
            }
        }

        this.logger.log(`📌 Processamento concluído: ${documentAdditional.length} documento(s) complementar(es) enviado(s) para ANS`);
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