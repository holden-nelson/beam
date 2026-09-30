# Beam Hair Salon

The website for Beam Hair Salon in Ketchum, Idaho. It presents Beam's services, team, and gallery in a mobile-first interface and includes an embedded Square appointment-booking flow.

## Tech stack

- [Astro 7](https://astro.build/)
- [Tailwind CSS 4](https://tailwindcss.com/)
- [Cloudflare adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/)

## Requirements

- Node.js 22.12 or newer
- npm

## Local development

Install dependencies and start the development server:

```sh
npm install
npm run dev
```

The site is available at `http://localhost:4321` by default.

### Square API configuration

The site's backend api integrates with Square as the source of truth for ecommerce.

Copy `.dev.vars.example` to `.dev.vars` and add a Square access
token with `ITEMS_READ` and `INVENTORY_READ` permissions for local requests. 

Set the deployed production token as a Cloudflare secret:

```sh
npx wrangler secret put SQUARE_ACCESS_TOKEN
```
See [backend-architecture.md](./docs/backend-architecture.md) for more details and api contract.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Create a production build in `dist/` |
| `npm test` | Run unit tests |
| `npm run preview` | Preview the production build locally |
| `npm run generate-types` | Generate Cloudflare runtime types |
| `npm run astro -- --help` | Display Astro CLI help |

## Project structure

```text
src/
├── assets/       Images, logos, and local fonts
├── components/   Shared navigation, footer, team, and booking UI
├── data/         Structured service-menu content
├── layouts/      Shared page layout
├── pages/        File-based routes
└── styles/       Global styles and design tokens
```

The main routes are:

- `/` — homepage and team
- `/services` — service menus
- `/gallery` — image gallery

## Updating content

- Edit service offerings in `src/data/service-menus.json`.
- Add or replace site imagery in `src/assets/images/`.
- Update team information in `src/components/FamSection.astro`.
- Update the Square booking widget in `src/components/BookingModal.astro`.
- Adjust shared colors, typography, and global styles in `src/styles/global.css`.

## Production

Run `npm run build` to generate the production site in `dist/`. Cloudflare deployment settings are defined in `wrangler.jsonc`.
