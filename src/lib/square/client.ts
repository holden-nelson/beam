export type SquareEnvironment = 'sandbox' | 'production';

export interface SquareClientConfig {
	environment: SquareEnvironment;
	accessToken: string;
}

export interface SquareApiClient {
	post<T>(path: string, body: Record<string, unknown>): Promise<T>;
}

export class SquareApiError extends Error {
	constructor(
		message: string,
		readonly status?: number,
		readonly requestId?: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = 'SquareApiError';
	}
}

const API_VERSION = '2026-09-16';
const API_ORIGINS: Record<SquareEnvironment, string> = {
	sandbox: 'https://connect.squareupsandbox.com',
	production: 'https://connect.squareup.com',
};

export class SquareClient implements SquareApiClient {
	constructor(
		private readonly config: SquareClientConfig,
		private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
	) {}

	async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
		let response: Response;

		try {
			response = await this.fetchImpl(`${API_ORIGINS[this.config.environment]}${path}`, {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					Authorization: `Bearer ${this.config.accessToken}`,
					'Content-Type': 'application/json',
					'Square-Version': API_VERSION,
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(10_000),
			});
		} catch (error) {
			throw new SquareApiError('Square request failed before receiving a response.', undefined, undefined, {
				cause: error,
			});
		}

		const requestId = response.headers.get('x-request-id') ?? undefined;
		let payload: unknown;

		try {
			payload = await response.json();
		} catch (error) {
			throw new SquareApiError('Square returned invalid JSON.', response.status, requestId, {
				cause: error,
			});
		}

		const errors = isRecord(payload) && Array.isArray(payload.errors) ? payload.errors : [];
		if (!response.ok || errors.length > 0) {
			throw new SquareApiError('Square returned an error response.', response.status, requestId);
		}

		return payload as T;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
