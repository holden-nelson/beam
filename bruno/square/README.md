# Beam Square API collection

This Bruno collection exercises the Square REST calls required by
`docs/backend-architecture.md`. It intentionally contains no Astro endpoints,
webhooks, refunds, direct payment creation, or fulfillment updates.

## Prerequisites

- A Square Sandbox seller account with at least one active location.
- A Sandbox catalog item with a fixed-price variation and tracked inventory.
- A Square access token with these permissions:
  - `MERCHANT_PROFILE_READ`
  - `ITEMS_READ`
  - `INVENTORY_READ`
  - `ORDERS_READ`
  - `ORDERS_WRITE`
  - `PAYMENTS_READ`
  - `PAYMENTS_WRITE`

## Configure Bruno

1. Open this directory as a Bruno collection. `Sandbox` is the default
   environment.
2. Open the Sandbox environment and enter `accessToken` in the Secrets tab.
   Bruno stores the value locally and does not write it to the environment file.
3. Run **List Locations**, then replace `locationId` in the Sandbox environment
   with the active salon location ID.
4. Create or select the Square category used to publish products in the Beam
   shop, then replace `shopCategoryId` with its Sandbox category ID.
5. Run **Search Shop Catalog**, choose a nested `ITEM_VARIATION` with a fixed
   price, and replace `variationId` in the Sandbox environment.
6. Copy an ID from an item's `item_data.image_ids` list into `imageId` to use
   **Retrieve Catalog Image**.
7. Set `siteUrl` to the HTTPS origin that should receive the checkout return.
   Use an HTTPS tunnel or deployed preview when testing the actual redirect.

## Sandbox checkout workflow

Run these requests in order:

1. **List Locations**
2. **List Catalog** and, when a cursor is returned, **List Catalog - Next Page**
3. **Search Shop Catalog** and, when a cursor is returned, **Search Shop
   Catalog - Next Page**
4. **Retrieve Catalog Image** to resolve an `imageId` to `image_data.url`
5. **Batch Retrieve Catalog Objects**
6. **Batch Retrieve Inventory Counts**
7. **Create Payment Link**
8. Open the runtime `checkoutUrl` in a browser and complete Sandbox payment.
9. **Retrieve Order**
10. **Get Payment**

The checkout request generates one runtime `attemptId`. Resending it in the
same Bruno session reuses that key and verifies that Square returns the same
payment link and order. Restart Bruno, or begin a new collection run, to create
a new checkout attempt.

`Retrieve Order` captures the first tender `payment_id` for `Get Payment`. A
paid pickup order can remain `OPEN` while its fulfillment is incomplete, so
payment completion—not order state—is the confirmation signal.

After paying, inspect `fulfillments[0].pickup_details.recipient` to see whether
Square enriched the placeholder `Online Customer` with buyer-provided contact
details. This is intentionally observational because the proposed Astro
checkout request does not collect buyer identity before redirecting to Square.

## Pagination

The first list, shop search, and inventory requests save returned cursors as
Bruno runtime variables. Their **Next Page** requests consume and replace those
cursors. Stop when the response no longer contains a cursor.

## Shop catalog filter

**Search Shop Catalog** returns only non-archived `REGULAR` products assigned
to `shopCategoryId` and enabled at `locationId`. This excludes Square items
whose product type is `APPOINTMENTS_SERVICE`, such as bookable haircuts. The
category is the explicit opt-in for publishing a product in the Beam shop.

## Production safety

Production has its own environment because Square credentials, locations,
catalog IDs, inventory, and orders are environment-specific. Read requests can
use it after its variables and secret token are configured.

**Create Payment Link** refuses to call `https://connect.squareup.com` unless
`allowProductionWrites` is deliberately changed to `true`. Change it back to
`false` immediately after an intentional production checkout test.

## Fixture choices

- One catalog variation and quantity are parameterized. Duplicate the line-item
  object when manually testing a multi-item cart.
- Square applies catalog taxes and automatic discounts through
  `order.pricing_options`; the request never supplies a price.
- Pickup is `ASAP` with a configurable `PT15M` test preparation duration.
- Shipping, tipping, coupon entry, and loyalty are disabled.
- The return URL is `{{siteUrl}}/checkout/complete`.
