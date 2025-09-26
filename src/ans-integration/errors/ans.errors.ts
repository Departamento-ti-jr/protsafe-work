export class AnsAuthenticationError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'AnsAuthenticationError';
  }
}

export class AnsPetitionError extends Error {
  constructor(message: string, public readonly statusCode?: number, public readonly responseData?: any) {
    super(message);
    this.name = 'AnsPetitionError';
  }
}

export class AnsDocumentUploadError extends Error {
  constructor(message: string, public readonly filename?: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'AnsDocumentUploadError';
  }
}

export class VaultConnectionError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(message);
    this.name = 'VaultConnectionError';
  }
}

export class InvalidMessageError extends Error {
  constructor(message: string, public readonly messageBody?: string) {
    super(message);
    this.name = 'InvalidMessageError';
  }
}