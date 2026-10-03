export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
    public readonly code: string = defaultCode(statusCode),
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message = 'Bad request', details?: unknown, code = 'BAD_REQUEST') {
    return new ApiError(400, message, details, code);
  }

  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    return new ApiError(401, message, undefined, code);
  }

  static forbidden(message = 'Forbidden', code = 'FORBIDDEN', details?: unknown) {
    return new ApiError(403, message, details, code);
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, message, undefined, 'NOT_FOUND');
  }

  static conflict(message: string, code: string, details?: unknown) {
    return new ApiError(409, message, details, code);
  }

  static tooMany(message: string, details?: unknown, code = 'TOO_MANY_ATTEMPTS') {
    return new ApiError(429, message, details, code);
  }
}

function defaultCode(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'TOO_MANY_ATTEMPTS';
    default:
      return statusCode >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
  }
}
