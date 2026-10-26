# Cookidoo to Nemlig

A self-hostable shopping-list review website and offline CLI. The website uses
the same saved products, approved decisions and review engine as the dry run.

## Run the Website

Use Node.js 22 or newer. No dependency installation or build step is needed.

```sh
node server.mjs
```

Open http://127.0.0.1:3000. Optional environment settings:

- `HOST`: listen address, default `127.0.0.1`.
- `PORT`: listen port, default `3000`.
- `PUBLIC_ORIGIN`: public address also allowed to submit reviews, for example
  `https://elena.danicampa.com`. Unset by default.
- `ACCESS_KEY`: optional long random secret. When set, each device must open
  `/?key=<ACCESS_KEY>` once; it then stays signed in for one year with an
  `HttpOnly`, `Secure` cookie. Changing the key signs out every device.

```sh
PORT=8080 node server.mjs
```

The editor starts empty. Paste a list, then select **Review list** to save and
review it. **Empty list**, beside the review button, clears the editor and
review without deleting previous files. Products include expandable original source lines,
pack quantities, approved substitutions and estimate markers. Missing and
excluded ingredients remain separate and are never included in the import link.
Search matches product names, SKUs, original ingredients and source lines.

**Copy link** copies the resolved selection. **Open Nemlig** asks for confirmation
because opening the link can change the Nemlig basket. It does not open
automatically. Prices and availability are unchecked; checkout is always manual.
Editing the input disables both link actions until the list is reviewed again.

Each successful **Review list** saves the exact input on the server in
`data/shopping-lists/YYYY-MM-DD-vN.txt`, for example `data/shopping-lists/2026-10-23-v1.txt`.
Dates use the server's local timezone. Versions start at 1 each day and increase
for every review, even for identical text. Existing files are never overwritten,
including simultaneous submissions from different devices. The filename is
shown below the editor after saving. The directory is created automatically.
Unreviewed edits are not saved, and reloading starts with a blank editor.

The website does not modify `data/shopping_list`, products, approved decisions,
household state or invoices. When input does not match the approved
fingerprints, the existing engine falls back to generic matching and the
website displays its warning.

**Household supplies**, below the review, shows the same read-only status as
`node household-supplies.mjs`: each tracked item's label, stock question, last
purchase and recheck date, based on `data/fakturas/` on the server. Receipt
rows and filenames are not sent to the browser. Stock answers and offer checks
are still recorded with the assistant/CLI.

## Future Features

- Live price and availability checks from the website, including comparison of
  multiple saved matches by total cost to cover the required quantity. Choose
  the cheapest suitable available option, preserving form, dietary and conversion
  rules. Show verified product links, check time and delivery context; failed or
  stale checks must not be presented as current prices. This requires a reliable
  live catalogue integration and is not implemented. Reviews remain offline with
  first-match selection until then; no automatic basket or saved-product changes.

## Linux Hosting

Copy this repository to the server, keeping `server.mjs`, `data/`, `lib/` and
`web/` together. Use a maintained Node.js 22+ runtime.
Paths are relative to the module, not the shell's current directory.

Run as a regular unprivileged user. For example, place the following unit at
`/etc/systemd/system/cookidoo-nemlig.service`, replacing `YOUR_USER`, the paths
and the Node executable path with your server's values. Before starting it,
create `/srv/cookidoo-nemlig/data/shopping-lists`, writable by the service user. The
rest of the repository may remain read-only.

```ini
[Unit]
Description=Cookidoo to Nemlig shopping review
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/srv/cookidoo-nemlig
ExecStart=/usr/bin/node /srv/cookidoo-nemlig/server.mjs
Environment=HOST=127.0.0.1
Environment=PORT=3000
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/srv/cookidoo-nemlig/data/shopping-lists
ProtectHome=read-only
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Enable and start the unit using your server's systemd administration tools.
Put an HTTPS reverse proxy such as Caddy or nginx in front of
`127.0.0.1:3000`, preserving the original `Host` header. If the proxy cannot,
set `PUBLIC_ORIGIN`. HTTPS also enables clipboard copying away from localhost.
The app itself does not terminate TLS.

There is no built-in login unless `ACCESS_KEY` is set: otherwise use a private
network/VPN or authenticated reverse proxy before exposing it online. Without
one of these, anyone who can access the app can request
reviews and create saved list versions. History, invoice and product data files are not
served as static downloads. Only the three frontend assets, the review API and
the read-only household summary are exposed; the app makes no catalogue
requests or automatic basket changes.

For trusted LAN access without a reverse proxy, explicitly bind all interfaces:

```sh
HOST=0.0.0.0 PORT=3000 node server.mjs
```

## CLI and Verification

```sh
node dry-run.mjs data/shopping_list
node --test test/*.test.mjs
```

The server tests cover engine parity, exact-text versioned saves, concurrent
version allocation, unchanged source data, input validation,
cross-origin rejection, the configured public origin, device access keys,
the read-only household summary, static assets and private-file isolation. Browser layout
and clipboard behavior require a browser check on the target device.

See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for selection rules and the household and
invoice workflows. Apart from the read-only household summary, those
assistant-assisted workflows are not website features.
