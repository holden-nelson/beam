import type { SquareApiClient } from './square/client';

export interface ProductImage {
	id: string;
	url: string;
	alt: string;
}

export interface ProductOptionValue {
	id: string;
	name: string;
}

export interface ProductOptionGroup {
	id: string;
	name: string;
	values: ProductOptionValue[];
}

export interface ProductVariation {
	id: string;
	name: string;
	optionValues: Array<{ optionId: string; valueId: string }>;
	price: { amount: number; currency: string };
	available: boolean;
	availableQuantity: number;
	imageIds: string[];
}

export interface Product {
	id: string;
	name: string;
	images: ProductImage[];
	optionGroups: ProductOptionGroup[];
	defaultVariationId: string;
	variations: ProductVariation[];
}

export interface ProductsConfig {
	locationId: string;
	categoryId: string;
}

interface Money {
	amount?: number;
	currency?: string;
}

interface LocationOverride {
	location_id?: string;
	price_money?: Money;
	pricing_type?: string;
	track_inventory?: boolean;
	sold_out?: boolean;
}

export interface CatalogObject {
	type?: string;
	id?: string;
	is_deleted?: boolean;
	present_at_all_locations?: boolean;
	present_at_location_ids?: string[];
	absent_at_location_ids?: string[];
	item_data?: {
		name?: string;
		product_type?: string;
		is_archived?: boolean;
		variations?: CatalogObject[];
		image_ids?: string[];
		item_options?: Array<{ item_option_id?: string }>;
	};
	item_variation_data?: {
		name?: string;
		ordinal?: number;
		pricing_type?: string;
		price_money?: Money;
		location_overrides?: LocationOverride[];
		track_inventory?: boolean;
		sellable?: boolean;
		image_ids?: string[];
		item_option_values?: Array<{ item_option_id?: string; item_option_value_id?: string }>;
	};
	image_data?: {
		url?: string;
		caption?: string;
	};
	item_option_data?: {
		name?: string;
		display_name?: string;
		values?: CatalogObject[];
	};
	item_option_value_data?: {
		item_option_id?: string;
		name?: string;
		ordinal?: number;
	};
}

export interface InventoryCount {
	catalog_object_id?: string;
	location_id?: string;
	state?: string;
	quantity?: string;
}

interface SearchCatalogResponse {
	items?: CatalogObject[];
	cursor?: string;
}

interface BatchRetrieveCatalogResponse {
	objects?: CatalogObject[];
}

interface BatchRetrieveInventoryResponse {
	counts?: InventoryCount[];
	cursor?: string;
}

interface ResolvedVariation {
	id: string;
	name: string;
	ordinal: number;
	price: { amount: number; currency: string };
	soldOut: boolean;
	imageIds: string[];
	optionValueRefs: Array<{ optionId: string; valueId: string }>;
}

export class SquareDataError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SquareDataError';
	}
}

export async function loadProducts(client: SquareApiClient, config: ProductsConfig): Promise<Product[]> {
	const items = await searchCatalog(client, config);
	const variationIds = collectEligibleVariationIds(items, config.locationId);
	const catalogObjectIds = collectReferencedCatalogObjectIds(items, config.locationId);

	const [catalogObjects, inventoryCounts] = await Promise.all([
		batchRetrieveCatalogObjects(client, catalogObjectIds),
		batchRetrieveInventoryCounts(client, variationIds, config.locationId),
	]);

	return buildProducts(items, catalogObjects, inventoryCounts, config.locationId);
}

export function buildProducts(
	items: CatalogObject[],
	referencedObjects: CatalogObject[],
	inventoryCounts: InventoryCount[],
	locationId: string,
): Product[] {
	const objectById = new Map<string, CatalogObject>();
	for (const object of referencedObjects) {
		if (!object.id) throw new SquareDataError('A referenced catalog object has no ID.');
		objectById.set(object.id, object);
	}

	const quantityByVariationId = buildInventoryMap(inventoryCounts, locationId);
	const products: Product[] = [];

	for (const item of items) {
		if (item.type !== 'ITEM' || !item.id || !item.item_data?.name) {
			throw new SquareDataError('Catalog search returned an invalid item.');
		}

		if (!isEligibleItem(item, locationId)) {
			continue;
		}

		const resolved = (item.item_data.variations ?? [])
			.map((variation, index) => resolveVariation(variation, locationId, index))
			.filter((variation): variation is ResolvedVariation => variation !== null)
			.sort((left, right) => left.ordinal - right.ordinal);

		if (resolved.length === 0) continue;

		const optionGroups = resolveOptionGroups(item, resolved, objectById);
		const variations = resolved.map((variation) => {
			validateVariationOptions(variation, optionGroups);
			const availableQuantity = quantityByVariationId.get(variation.id) ?? 0;

			return {
				id: variation.id,
				name: variation.name,
				optionValues: optionGroups.map((group) => {
					const reference = variation.optionValueRefs.find((value) => value.optionId === group.id);
					if (!reference) throw new SquareDataError('A variation is missing an item option value.');
					return reference;
				}),
				price: variation.price,
				available: availableQuantity > 0 && !variation.soldOut,
				availableQuantity,
				imageIds: variation.imageIds,
			};
		});

		const images = resolveImages(item, resolved, objectById);
		const defaultVariation = variations.find((variation) => variation.available) ?? variations[0];

		products.push({
			id: item.id,
			name: item.item_data.name,
			images,
			optionGroups,
			defaultVariationId: defaultVariation.id,
			variations,
		});
	}

	return products;
}

async function searchCatalog(client: SquareApiClient, config: ProductsConfig): Promise<CatalogObject[]> {
	const items: CatalogObject[] = [];
	const cursors = new Set<string>();
	let cursor: string | undefined;

	do {
		const response = await client.post<SearchCatalogResponse>('/v2/catalog/search-catalog-items', {
			product_types: ['REGULAR'],
			category_ids: [config.categoryId],
			enabled_location_ids: [config.locationId],
			archived_state: 'ARCHIVED_STATE_NOT_ARCHIVED',
			sort_order: 'ASC',
			limit: 100,
			...(cursor ? { cursor } : {}),
		});

		if (response.items !== undefined && !Array.isArray(response.items)) {
			throw new SquareDataError('Catalog search returned invalid items.');
		}

		items.push(...(response.items ?? []));
		cursor = nextCursor(response.cursor, cursors);
	} while (cursor);

	return items;
}

async function batchRetrieveCatalogObjects(
	client: SquareApiClient,
	objectIds: string[],
): Promise<CatalogObject[]> {
	const objects: CatalogObject[] = [];

	for (const ids of chunks(objectIds, 1_000)) {
		const response = await client.post<BatchRetrieveCatalogResponse>('/v2/catalog/batch-retrieve', {
			object_ids: ids,
		});
		if (response.objects !== undefined && !Array.isArray(response.objects)) {
			throw new SquareDataError('Catalog batch retrieval returned invalid objects.');
		}
		objects.push(...(response.objects ?? []));
	}

	const returnedIds = new Set(objects.map((object) => object.id));
	if (objectIds.some((id) => !returnedIds.has(id))) {
		throw new SquareDataError('Catalog batch retrieval omitted a referenced object.');
	}

	return objects;
}

async function batchRetrieveInventoryCounts(
	client: SquareApiClient,
	variationIds: string[],
	locationId: string,
): Promise<InventoryCount[]> {
	const counts: InventoryCount[] = [];

	for (const ids of chunks(variationIds, 1_000)) {
		const cursors = new Set<string>();
		let cursor: string | undefined;

		do {
			const response = await client.post<BatchRetrieveInventoryResponse>(
				'/v2/inventory/counts/batch-retrieve',
				{
					catalog_object_ids: ids,
					location_ids: [locationId],
					states: ['IN_STOCK'],
					limit: 1_000,
					...(cursor ? { cursor } : {}),
				},
			);

			if (response.counts !== undefined && !Array.isArray(response.counts)) {
				throw new SquareDataError('Inventory retrieval returned invalid counts.');
			}

			counts.push(...(response.counts ?? []));
			cursor = nextCursor(response.cursor, cursors);
		} while (cursor);
	}

	return counts;
}

function collectEligibleVariationIds(items: CatalogObject[], locationId: string): string[] {
	const ids: string[] = [];
	for (const item of items) {
		if (!isEligibleItem(item, locationId)) continue;
		for (const variation of item.item_data?.variations ?? []) {
			const resolved = resolveVariation(variation, locationId, ids.length);
			if (resolved) ids.push(resolved.id);
		}
	}
	return [...new Set(ids)];
}

function collectReferencedCatalogObjectIds(items: CatalogObject[], locationId: string): string[] {
	const ids: string[] = [];
	for (const item of items) {
		if (!isEligibleItem(item, locationId)) continue;
		const eligibleVariations = (item.item_data?.variations ?? [])
			.map((variation, index) => resolveVariation(variation, locationId, index))
			.filter((variation): variation is ResolvedVariation => variation !== null);
		if (eligibleVariations.length === 0) continue;

		ids.push(...readIds(item.item_data?.image_ids, 'item image'));
		for (const option of item.item_data?.item_options ?? []) {
			if (!option.item_option_id) throw new SquareDataError('An item option reference has no ID.');
			ids.push(option.item_option_id);
		}
		for (const variation of eligibleVariations) {
			ids.push(...variation.imageIds);
		}
	}
	return [...new Set(ids)];
}

function resolveVariation(
	variation: CatalogObject,
	locationId: string,
	fallbackOrdinal: number,
): ResolvedVariation | null {
	const data = variation.item_variation_data;
	if (
		variation.type !== 'ITEM_VARIATION' ||
		variation.is_deleted === true ||
		!isEnabledAtLocation(variation, locationId) ||
		!variation.id ||
		!data ||
		data.sellable === false
	) {
		return null;
	}

	const override = data.location_overrides?.find((entry) => entry.location_id === locationId);
	const pricingType = override?.pricing_type ?? data.pricing_type;
	const price = override?.price_money ?? data.price_money;
	const amount = price?.amount;
	const currency = price?.currency;
	const tracksInventory = override?.track_inventory ?? data.track_inventory ?? false;

	if (pricingType !== 'FIXED_PRICING' || !tracksInventory) return null;
	if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0 || !currency) {
		return null;
	}

	if (!data.name) throw new SquareDataError('An eligible variation has no name.');

	const optionValueRefs = (data.item_option_values ?? []).map((reference) => {
		if (!reference.item_option_id || !reference.item_option_value_id) {
			throw new SquareDataError('A variation has an invalid item option value reference.');
		}
		return { optionId: reference.item_option_id, valueId: reference.item_option_value_id };
	});

	return {
		id: variation.id,
		name: data.name,
		ordinal: Number.isFinite(data.ordinal) ? (data.ordinal as number) : fallbackOrdinal,
		price: { amount, currency },
		soldOut: override?.sold_out === true,
		imageIds: readIds(data.image_ids, 'variation image'),
		optionValueRefs,
	};
}

function resolveOptionGroups(
	item: CatalogObject,
	variations: ResolvedVariation[],
	objectById: Map<string, CatalogObject>,
): ProductOptionGroup[] {
	const groups: ProductOptionGroup[] = [];

	for (const reference of item.item_data?.item_options ?? []) {
		const optionId = reference.item_option_id;
		if (!optionId) throw new SquareDataError('An item option reference has no ID.');
		const option = objectById.get(optionId);
		const data = option?.item_option_data;
		if (option?.type !== 'ITEM_OPTION' || !data || !(data.display_name || data.name)) {
			throw new SquareDataError('An item option could not be resolved.');
		}

		const usedValueIds = new Set(
			variations.flatMap((variation) =>
				variation.optionValueRefs
					.filter((value) => value.optionId === optionId)
					.map((value) => value.valueId),
			),
		);
		if (usedValueIds.size === 0) continue;

		const values = (data.values ?? [])
			.map((value, index) => {
				if (value.type !== 'ITEM_OPTION_VAL' || !value.id || !value.item_option_value_data?.name) {
					throw new SquareDataError('An item option contains an invalid value.');
				}
				return {
					id: value.id,
					name: value.item_option_value_data.name,
					ordinal: Number.isFinite(value.item_option_value_data.ordinal)
						? (value.item_option_value_data.ordinal as number)
						: index,
				};
			})
			.filter((value) => usedValueIds.has(value.id))
			.sort((left, right) => left.ordinal - right.ordinal)
			.map(({ id, name }) => ({ id, name }));

		if (values.length !== usedValueIds.size) {
			throw new SquareDataError('An item option value could not be resolved.');
		}

		groups.push({ id: optionId, name: data.display_name || data.name!, values });
	}

	return groups;
}

function validateVariationOptions(variation: ResolvedVariation, groups: ProductOptionGroup[]): void {
	if (groups.length === 0 && variation.optionValueRefs.length === 0) return;
	if (variation.optionValueRefs.length !== groups.length) {
		throw new SquareDataError('A variation does not match the item option groups.');
	}

	for (const reference of variation.optionValueRefs) {
		const group = groups.find((option) => option.id === reference.optionId);
		if (!group?.values.some((value) => value.id === reference.valueId)) {
			throw new SquareDataError('A variation references an unknown item option value.');
		}
	}
}

function resolveImages(
	item: CatalogObject,
	variations: ResolvedVariation[],
	objectById: Map<string, CatalogObject>,
): ProductImage[] {
	const imageIds = [
		...readIds(item.item_data?.image_ids, 'item image'),
		...variations.flatMap((variation) => variation.imageIds),
	];
	const uniqueImageIds = [...new Set(imageIds)];

	return uniqueImageIds.map((id) => {
		const image = objectById.get(id);
		const url = image?.image_data?.url;
		if (image?.type !== 'IMAGE' || !url || !isHttpsUrl(url)) {
			throw new SquareDataError('A catalog image could not be resolved.');
		}
		return {
			id,
			url,
			alt: image.image_data?.caption?.trim() || item.item_data!.name!,
		};
	});
}

function buildInventoryMap(counts: InventoryCount[], locationId: string): Map<string, number> {
	const quantities = new Map<string, number>();
	for (const count of counts) {
		if (
			count.location_id !== locationId ||
			count.state !== 'IN_STOCK' ||
			!count.catalog_object_id ||
			quantities.has(count.catalog_object_id)
		) {
			continue;
		}

		const quantity = Number(count.quantity);
		if (!Number.isFinite(quantity)) throw new SquareDataError('Square returned an invalid inventory quantity.');
		quantities.set(count.catalog_object_id, Math.max(0, Math.floor(quantity)));
	}
	return quantities;
}

function isEnabledAtLocation(object: CatalogObject, locationId: string): boolean {
	if (object.absent_at_location_ids?.includes(locationId)) return false;
	return object.present_at_all_locations === true || object.present_at_location_ids?.includes(locationId) === true;
}

function isEligibleItem(item: CatalogObject, locationId: string): boolean {
	return (
		item.type === 'ITEM' &&
		item.is_deleted !== true &&
		item.item_data?.is_archived !== true &&
		item.item_data?.product_type === 'REGULAR' &&
		isEnabledAtLocation(item, locationId)
	);
}

function readIds(ids: string[] | undefined, field: string): string[] {
	if (ids === undefined) return [];
	if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || id.length === 0)) {
		throw new SquareDataError(`Square returned an invalid ${field} ID list.`);
	}
	return ids;
}

function nextCursor(cursor: string | undefined, seen: Set<string>): string | undefined {
	if (!cursor) return undefined;
	if (seen.has(cursor)) throw new SquareDataError('Square returned a repeated pagination cursor.');
	seen.add(cursor);
	return cursor;
}

function chunks<T>(values: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === 'https:';
	} catch {
		return false;
	}
}
