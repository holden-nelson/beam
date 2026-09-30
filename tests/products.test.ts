import { describe, expect, it, vi } from 'vitest';
import {
	buildProducts,
	loadProducts,
	SquareDataError,
	type CatalogObject,
	type InventoryCount,
} from '../src/lib/products';
import type { SquareApiClient } from '../src/lib/square/client';

const locationId = 'LOCATION';

describe('buildProducts', () => {
	it('projects options, image URLs, location pricing, inventory, and defaults', () => {
		const item = catalogItem([
			variation('LARGE', 'Large', 2, {
				imageIds: ['VARIATION_IMAGE'],
				optionValueId: 'LARGE_VALUE',
			}),
			variation('SMALL', 'Small', 1, {
				imageIds: ['ITEM_IMAGE'],
				optionValueId: 'SMALL_VALUE',
				priceOverride: 3_500,
			}),
		]);
		const objects: CatalogObject[] = [
			image('ITEM_IMAGE', 'https://images.squareup.com/item.jpg', 'Model wearing the hat'),
			image('VARIATION_IMAGE', 'https://images.squareup.com/large.jpg'),
			{
				type: 'ITEM_OPTION',
				id: 'SIZE',
				item_option_data: {
					name: 'Internal size',
					display_name: 'Size',
					values: [
						optionValue('LARGE_VALUE', 'Large', 2),
						optionValue('SMALL_VALUE', 'Small', 1),
					],
				},
			},
		];
		const counts: InventoryCount[] = [
			inventory('SMALL', '4.9'),
			inventory('LARGE', '0'),
		];

		expect(buildProducts([item], objects, counts, locationId)).toEqual([
			{
				id: 'ITEM',
				name: 'B Hat',
				images: [
					{
						id: 'ITEM_IMAGE',
						url: 'https://images.squareup.com/item.jpg',
						alt: 'Model wearing the hat',
					},
					{
						id: 'VARIATION_IMAGE',
						url: 'https://images.squareup.com/large.jpg',
						alt: 'B Hat',
					},
				],
				optionGroups: [
					{
						id: 'SIZE',
						name: 'Size',
						values: [
							{ id: 'SMALL_VALUE', name: 'Small' },
							{ id: 'LARGE_VALUE', name: 'Large' },
						],
					},
				],
				defaultVariationId: 'SMALL',
				variations: [
					{
						id: 'SMALL',
						name: 'Small',
						optionValues: [{ optionId: 'SIZE', valueId: 'SMALL_VALUE' }],
						price: { amount: 3_500, currency: 'USD' },
						available: true,
						availableQuantity: 4,
						imageIds: ['ITEM_IMAGE'],
					},
					{
						id: 'LARGE',
						name: 'Large',
						optionValues: [{ optionId: 'SIZE', valueId: 'LARGE_VALUE' }],
						price: { amount: 3_000, currency: 'USD' },
						available: false,
						availableQuantity: 0,
						imageIds: ['VARIATION_IMAGE'],
					},
				],
			},
		]);
	});

	it('keeps sold-out variations and omits ineligible variations', () => {
		const soldOut = variation('SOLD_OUT', 'Regular', 1, { soldOut: true, withOption: false });
		const variable = variation('VARIABLE', 'Variable', 2, { withOption: false });
		variable.item_variation_data!.pricing_type = 'VARIABLE_PRICING';
		const untracked = variation('UNTRACKED', 'Untracked', 3, { withOption: false });
		untracked.item_variation_data!.track_inventory = false;
		const item = catalogItem([soldOut, variable, untracked], false);

		const [product] = buildProducts([item], [], [inventory('SOLD_OUT', '8')], locationId);

		expect(product.variations).toHaveLength(1);
		expect(product.variations[0]).toMatchObject({
			id: 'SOLD_OUT',
			available: false,
			availableQuantity: 8,
		});
	});

	it('fails the whole projection when referenced image metadata is missing', () => {
		const item = catalogItem([variation('ONLY', 'Regular', 1, { withOption: false })], false);
		item.item_data!.image_ids = ['MISSING'];

		expect(() => buildProducts([item], [], [], locationId)).toThrow(SquareDataError);
	});
});

describe('loadProducts', () => {
	it('consumes catalog and inventory pagination', async () => {
		const item = catalogItem([variation('ONLY', 'Regular', 1, { withOption: false })], false);
		const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
			if (path === '/v2/catalog/search-catalog-items') {
				return body.cursor ? { items: [] } : { items: [item], cursor: 'catalog-next' };
			}
			if (path === '/v2/inventory/counts/batch-retrieve') {
				return body.cursor
					? { counts: [] }
					: { counts: [inventory('ONLY', '2')], cursor: 'inventory-next' };
			}
			throw new Error(`Unexpected path: ${path}`);
		});
		const client: SquareApiClient = {
			post: async <T>(path: string, body: Record<string, unknown>) =>
				(await post(path, body)) as T,
		};

		const products = await loadProducts(client, { locationId, categoryId: 'CATEGORY' });

		expect(products[0].variations[0].availableQuantity).toBe(2);
		expect(post).toHaveBeenCalledTimes(4);
		expect(post).toHaveBeenNthCalledWith(
			2,
			'/v2/catalog/search-catalog-items',
			expect.objectContaining({ cursor: 'catalog-next' }),
		);
		expect(post).toHaveBeenNthCalledWith(
			4,
			'/v2/inventory/counts/batch-retrieve',
			expect.objectContaining({ cursor: 'inventory-next' }),
		);
	});
});

function catalogItem(variations: CatalogObject[], withOption = true): CatalogObject {
	return {
		type: 'ITEM',
		id: 'ITEM',
		present_at_all_locations: true,
		item_data: {
			name: 'B Hat',
			product_type: 'REGULAR',
			variations,
			image_ids: withOption ? ['ITEM_IMAGE'] : [],
			item_options: withOption ? [{ item_option_id: 'SIZE' }] : [],
		},
	};
}

function variation(
	id: string,
	name: string,
	ordinal: number,
	options: {
		imageIds?: string[];
		optionValueId?: string;
		priceOverride?: number;
		soldOut?: boolean;
		withOption?: boolean;
	} = {},
): CatalogObject {
	const withOption = options.withOption ?? true;
	return {
		type: 'ITEM_VARIATION',
		id,
		present_at_all_locations: true,
		item_variation_data: {
			name,
			ordinal,
			pricing_type: 'FIXED_PRICING',
			price_money: { amount: 3_000, currency: 'USD' },
			track_inventory: true,
			sellable: true,
			image_ids: options.imageIds ?? [],
			item_option_values: withOption
				? [{ item_option_id: 'SIZE', item_option_value_id: options.optionValueId }]
				: [],
			location_overrides:
				options.priceOverride !== undefined || options.soldOut
					? [
							{
								location_id: locationId,
								...(options.priceOverride !== undefined
									? { price_money: { amount: options.priceOverride, currency: 'USD' } }
									: {}),
								...(options.soldOut ? { sold_out: true } : {}),
							},
						]
					: [],
		},
	};
}

function image(id: string, url: string, caption?: string): CatalogObject {
	return { type: 'IMAGE', id, image_data: { url, caption } };
}

function optionValue(id: string, name: string, ordinal: number): CatalogObject {
	return {
		type: 'ITEM_OPTION_VAL',
		id,
		item_option_value_data: { item_option_id: 'SIZE', name, ordinal },
	};
}

function inventory(variationId: string, quantity: string): InventoryCount {
	return {
		catalog_object_id: variationId,
		location_id: locationId,
		state: 'IN_STOCK',
		quantity,
	};
}
