import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { loadProducts, SquareDataError } from '../../lib/products';
import { SquareApiError, SquareClient, type SquareEnvironment } from '../../lib/square/client';

export const prerender = false;

export const GET: APIRoute = async () => {
	let config: ReturnType<typeof readConfig>;

	try {
		config = readConfig(env);
	} catch {
		return json({ error: 'Server configuration error.' }, 500, 'no-store');
	}

	try {
		const client = new SquareClient({
			environment: config.environment,
			accessToken: config.accessToken,
		});
		const products = await loadProducts(client, config);
		return json(
			{ products },
			200,
			'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
		);
	} catch (error) {
		logUpstreamError(error);
		return json({ error: 'Unable to load products.' }, 502, 'no-store');
	}
};

function readConfig(bindings: Env): {
	environment: SquareEnvironment;
	accessToken: string;
	locationId: string;
	categoryId: string;
} {
	const environment = requireBinding(bindings.SQUARE_ENVIRONMENT, 'SQUARE_ENVIRONMENT');
	if (environment !== 'sandbox' && environment !== 'production') {
		throw new Error('Invalid SQUARE_ENVIRONMENT.');
	}

	return {
		environment,
		accessToken: requireBinding(bindings.SQUARE_ACCESS_TOKEN, 'SQUARE_ACCESS_TOKEN'),
		locationId: requireBinding(bindings.SQUARE_LOCATION_ID, 'SQUARE_LOCATION_ID'),
		categoryId: requireBinding(bindings.SQUARE_CATALOG_CATEGORY_ID, 'SQUARE_CATALOG_CATEGORY_ID'),
	};
}

function requireBinding(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`Missing ${name}.`);
	return value;
}

function json(body: unknown, status: number, cacheControl: string): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Cache-Control': cacheControl,
			'Content-Type': 'application/json; charset=utf-8',
		},
	});
}

function logUpstreamError(error: unknown): void {
	if (error instanceof SquareApiError) {
		console.error('Square products request failed.', {
			status: error.status,
			requestId: error.requestId,
		});
		return;
	}

	console.error('Square products response could not be processed.', {
		kind: error instanceof SquareDataError ? error.name : 'UnexpectedError',
	});
}
