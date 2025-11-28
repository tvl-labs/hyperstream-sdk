export interface HyperstreamErrorPayload {
  message?: string;
  code?: string;
  details?: unknown;
}

export class HyperstreamApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly requestId?: string | null;
  readonly causeResponseBody?: unknown;

  constructor(params: {
    message: string;
    status: number;
    code?: string;
    details?: unknown;
    requestId?: string | null;
    causeResponseBody?: unknown;
  }) {
    super(params.message);
    this.name = "HyperstreamApiError";
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
    this.requestId = params.requestId ?? null;
    this.causeResponseBody = params.causeResponseBody;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code,
      details: this.details,
      requestId: this.requestId,
    };
  }
}
