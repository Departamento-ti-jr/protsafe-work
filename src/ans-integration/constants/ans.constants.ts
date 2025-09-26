export const ANS_CONSTANTS = {
  DOCUMENT_TYPES: {
    PRINCIPAL: 'principal',
    COMPLEMENTAR: 'complementar'
  },
  PETITION_TYPES: {
    RECURSOS: 'recursos',
    IMPUGNACOES: 'impugnacoes'
  },
  OAUTH_SCOPE: 'br.gov.ans.eprotocolo.operadora br.gov.ans.eprotocolo.operadoras.notificacoes.r br.gov.ans.eprotocolo.operadoras.peticoes br.gov.ans.eprotocolo.operadoras.peticoes.r',
  DEFAULT_DOCUMENT_TYPE_ID: '6',
  RETRY_CONFIG: {
    MAX_RETRIES: 3,
    INITIAL_DELAY: 1000,
    MAX_DELAY: 10000
  }
} as const;

export const HTTP_TIMEOUTS = {
  ANS_REQUEST: 30000,
  VAULT_REQUEST: 5000,
  S3_UPLOAD: 60000
} as const;