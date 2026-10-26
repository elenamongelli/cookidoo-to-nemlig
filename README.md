# Cookidoo to Nemlig

This independent project is not affiliated with, endorsed by, or an official
solution from Cookidoo or Nemlig. Third-party names, logos and copyrighted
material remain the property of their respective rights holders.

A self-hosted shopping-list review website and offline CLI. Both use the same
product data, approved decisions and review engine. Requires Node.js 22+; no
dependencies or build step are needed.

## Run

```sh
node server.mjs
```

Open http://127.0.0.1:3000. Configure `HOST` and `PORT` as needed. To allow a
public origin, set `PUBLIC_ORIGIN`. For access control, set a long random
`ACCESS_KEY`; each device signs in once at `/?key=<ACCESS_KEY>` and receives a
one-year secure cookie.

Paste a list and choose **Review list**. Each review saves the exact input as a
new version in `data/shopping-lists/`; unreviewed edits are not saved. The
website uses existing approvals when fingerprints match, otherwise it warns
and falls back to generic matching. Missing and excluded ingredients stay out
of the import link.

The app does not check live prices or availability, modify products or
approvals, or add items to a basket automatically. Opening a Nemlig link
requires confirmation. The read-only household summary uses server-side
invoice data; receipt details are not sent to the browser.

## CLI

```sh
node dry-run.mjs data/shopping_list
node household-supplies.mjs
node --test test/*.test.mjs
```

## Hosting

Run the server as an unprivileged user with the repository's `data/`, `lib/`
and `web/` directories together. For internet access, use HTTPS through a
reverse proxy and configure `ACCESS_KEY` or an authenticated proxy. Without
access control, anyone who can reach the server can submit reviews and create
saved list versions. Set `PUBLIC_ORIGIN` if the proxy does not preserve `Host`.
The app does not terminate TLS.

See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for selection rules and
household and invoice workflows.
