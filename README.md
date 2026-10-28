# Misty Alphine

## Run locally

Requires Node.js 24 or newer. In PowerShell, copy the example settings to a private `.env` file and edit it to set a unique administrator password with at least 14 characters:

```powershell
Copy-Item .env.example .env
notepad .env
```

Save the file, then start the server:

```powershell
node server.js
```

Open `http://127.0.0.1:3000`. To manage the site, open **ADMIN** or go to `http://127.0.0.1:3000/admin.html` and sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env`. Do not open the HTML files directly with `file://`; the website and admin use the local server APIs.

## Bookings and admin security

Guest requests are stored in `data/misty-alphine.sqlite`. The admin can review guest contact details and stay dates, then set each request to pending, confirmed, or cancelled. A request is not a payment or a confirmed reservation. The administrator should contact the guest to confirm availability.

Admin sessions use random, server-validated tokens in HTTP-only, same-site cookies, expire after eight hours, and require CSRF protection for changes. Sign-in attempts and booking submissions are rate limited. Site edits and uploaded JPG, PNG, or WebP images are stored in the same SQLite database.

For an internet-facing deployment, use an HTTPS reverse proxy, keep the Node server bound to localhost, set `NODE_ENV=production` in `.env`, and let the proxy set `X-Forwarded-Proto: https`. Never expose `.env` or the `data` folder. Back up `data/misty-alphine.sqlite` securely; it contains private guest information. This project does not process payments, send booking confirmation emails, or guarantee room availability.
