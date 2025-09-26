export interface Operadora {
  ansRegister: string;
  name: string;
}

export interface ImpugnacaoRequest {
  operadora: Operadora;
  numeroABI: string;
  ordem: number;
  numeroProcesso: string;
  comp: string;
  dataFinal: string;
  numeroAihApac: string;
  registroAns: string;
  S3PdfPath: string;
  _id: string;
}

export interface AnsCredentials {
  scope: string;
  client_id: string;
  client_secret: string;
}

export interface AnsTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface DocumentAdditional {
  filename: string;
  s3path: string;
  documentType?: string;
}

export interface PetitionPayload {
  numeroProcesso: string;
  informacoesAdicionais: {
    competenciaAtendimento: string;
    dataFimAtendimento: string;
    numeroAtendimento: string;
  };
}