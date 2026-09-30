# Beam Backend API collection

This Bruno collection exercises Beam's public Astro API endpoints. It does not
call Square directly and does not require a Square access token.

## Environments

- `Local` targets `http://localhost:4321` and is the default.
- `Production` targets `https://beam.hair`.

For local requests, start Astro with `npm run dev` and configure the server's
Square access token in the gitignored `.dev.vars` file.

## Products

**List Products** calls `GET /api/products` and verifies the response envelope,
product and variation fields, option references, availability, and image URL
metadata. An empty `products` array is valid.

Run it from this collection directory with the Bruno CLI:

```sh
bru run "01 Products/01 List Products.bru" --env Local
```
