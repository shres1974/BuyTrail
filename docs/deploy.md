# Deploying the BuyTrail demo to a server (beginner guide)

This puts the **sample-data demo** online at `https://your-domain`. You end up with one Linux server running everything in Docker, plus Caddy for automatic HTTPS. It is still a demonstration (D0): every price is fictional and labelled, and file uploads stay disabled.

Time needed: about an hour the first time. You will need a credit card for the server and domain; check each provider's pricing page for current costs.

## What you need before starting

| Item | Why | Examples |
| --- | --- | --- |
| A small Linux server (VPS) | Runs the web app, worker, database, Redis and storage | Hetzner, DigitalOcean, AWS Lightsail. Ubuntu 24.04, **2 GB RAM minimum** (the image build needs it), 2 vCPU, 40 GB disk |
| A domain or subdomain | HTTPS certificates need a real name | `demo.yourname.com` from any registrar (Namecheap, Cloudflare, Porkbun) |
| An email-sending (SMTP) account | Sign-in links are emailed | Resend, Postmark, Amazon SES |
| Your SSH key | To log in to the server | You already have `~/.ssh/id_ed25519_personal.pub` |

## Step 1 — Create the server

1. In your VPS provider's dashboard, create a server with **Ubuntu 24.04**, at least **2 GB RAM**.
2. When asked for an SSH key, paste the contents of your public key:
   ```bash
   cat ~/.ssh/id_ed25519_personal.pub
   ```
3. Note the server's **public IPv4 address** (e.g. `203.0.113.10`).
4. In the provider's firewall settings (if it has one), allow inbound **22, 80, 443** only.

## Step 2 — Point your domain at the server

In your domain registrar's DNS settings, add:

| Type | Name | Value |
| --- | --- | --- |
| A | `demo` (or `@` for the bare domain) | your server IP |

Wait until this prints your server IP (it can take a few minutes):
```bash
dig +short demo.yourname.com
```

## Step 3 — Set up email sending

Using Resend as the example (others are similar):
1. Sign up, then **Domains → Add domain** → enter your domain.
2. Add the DNS records it shows (SPF/DKIM) at your registrar and wait until Resend shows **Verified**.
3. **API Keys → Create** → copy the key. This is your `SMTP_PASSWORD`.
4. SMTP settings for Resend: host `smtp.resend.com`, port `465`, user `resend`.

Without a verified domain, mail is rejected or lands in spam, and you won't be able to sign in.

## Step 4 — Prepare the server

```bash
ssh -i ~/.ssh/id_ed25519_personal root@SERVER_IP

# On the server:
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh          # installs Docker + the compose plugin
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
git clone https://github.com/shres1974/BuyTrail.git /opt/buytrail
cd /opt/buytrail
```

The repository is public, so cloning needs no credentials.

## Step 5 — Create the production configuration

```bash
cp .env.production.example .env.production
nano .env.production
```

Fill in:
- `SITE_DOMAIN` and `APP_BASE_URL` with your domain. `APP_BASE_URL` must start with `https://`.
- `AUTH_SECRET`, `POSTGRES_PASSWORD`, `OBJECT_STORAGE_ACCESS_KEY` and `OBJECT_STORAGE_SECRET_KEY`. Generate each value separately:
  ```bash
  openssl rand -hex 32
  ```
- `EMAIL_FROM` (an address on your verified domain), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and `SMTP_PASSWORD`.
- `SIGNIN_ALLOWLIST`, `EMAIL_TEST_ALLOWLIST` and `ADMIN_EMAILS` with your own email. Add anyone else you want to let in, comma-separated, or use `@theirdomain.com` to allow a whole domain.

Save with `Ctrl+O`, `Enter`, `Ctrl+X`. Then restrict who can read the file:
```bash
chmod 600 .env.production
```

The app refuses to start if a public deployment that sends real email has no `SIGNIN_ALLOWLIST`. That stops strangers from using your email account.

## Step 6 — Start it

```bash
docker compose -f infra/compose.prod.yaml --env-file .env.production up -d --build
```

The first run takes several minutes. It builds the image, creates the database, and seeds the demo catalog (~1 minute). Then check progress:

```bash
docker compose -f infra/compose.prod.yaml --env-file .env.production ps
docker compose -f infra/compose.prod.yaml --env-file .env.production logs -f caddy web worker   # Ctrl+C to stop following
```

`migrate` should show **Exited (0)**, `web` should be **healthy**, and the others **Up**.

## Step 7 — Check it works

1. Open `https://your-domain`. You should see the purple "sample data" banner and a padlock.
2. Open `https://your-domain/api/health`. It should show `"database":true` and `"worker":{"alive":true,...}`.
3. Sign in with an allowlisted email and click the link in your inbox. Because you're in `ADMIN_EMAILS`, an **Admin** tab appears.
4. Demo an alert:
   1. Open a product and choose a variant.
   2. Save a watch below the current best price.
   3. Use **Simulate a sample price change** to move one listing's price below your target.
   4. Check **Alerts** and your inbox.

## Updating after you push new code

```bash
ssh -i ~/.ssh/id_ed25519_personal root@SERVER_IP
cd /opt/buytrail && git pull
docker compose -f infra/compose.prod.yaml --env-file .env.production up -d --build
```

Migrations and the rerunnable demo seed run automatically on every start.

## Backups

A `backup` container writes a database dump to `/opt/buytrail/infra/backups/` daily and keeps the 7 most recent. Those copies are **on the same server**, so also copy them elsewhere now and then:
```bash
scp -i ~/.ssh/id_ed25519_personal root@SERVER_IP:/opt/buytrail/infra/backups/*.dump ./
```

To restore (stops the app, replaces the database):
```bash
docker compose -f infra/compose.prod.yaml --env-file .env.production stop web worker
docker compose -f infra/compose.prod.yaml --env-file .env.production exec -T postgres \
  pg_restore -U buytrail -d buytrail --clean --if-exists < infra/backups/FILE.dump
docker compose -f infra/compose.prod.yaml --env-file .env.production start web worker
```

Try a restore once before relying on it.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Browser says "connection refused" or there's no padlock | DNS isn't pointing at the server yet, or ports 80/443 are blocked. Check `dig +short your-domain` and the provider firewall. Look for certificate errors in `logs caddy`. |
| `web` keeps restarting | Run `logs web`. An `Invalid configuration:` line names the missing or bad setting in `.env.production`. |
| Sign-in says "Check your email" but nothing arrives | The address isn't in `SIGNIN_ALLOWLIST` (the page looks identical on purpose), the sending domain isn't verified, or SMTP details are wrong (`logs web`). Also check spam. |
| Build fails with "killed" or out of memory | The server needs ≥2 GB RAM. Add swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` |
| Health shows `"worker":{"alive":false}` | Run `logs worker`. Alerts and reminders don't run without it. |

## What this deployment does not cover

- **Live retailer data.** It stays a labelled demo until a source is approved (`docs/source-capabilities.md`).
- **Real receipt uploads.** They stay disabled. Visitors use the synthetic sample receipts.
- **Off-server backups and monitoring.** Set these up yourself if the demo matters. At minimum, use an uptime checker on `/api/health`.
- **OS security updates.** Run `apt upgrade` regularly, or enable `unattended-upgrades`.
