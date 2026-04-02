# Arknights: Endfield Auto Check in

Automated daily check-in script for Arknights: Endfield through SKPORT.

The script uses Puppeteer to:

1. Open the SKPORT sign-in page.
2. Reuse an existing session, or sign in with email and password when needed.
3. Resolve your Endfield role based on selected region.
4. Submit attendance check-in.
5. Repeat once per day at a random minute between 01:01 and 01:59.

## Requirements

- Node.js 22+
- npm
- Chromium/Chrome (only required when Puppeteer does not provide a browser automatically)

## Project Files

- `index.js`: Main script.
- `Dockerfile`: Container image setup with Chromium.
- `compose.yml`: Docker Compose service configuration.
- `.env`: Runtime credentials and region configuration.

## Environment Variables

Set values in `.env`:

| Variable | Required | Description |
| --- | --- | --- |
| `REGION` | Yes | One of `ASIA`, `AMERICAS`, or `EUROPE`. |
| `SKPORT_EMAIL` | Yes | SKPORT email. |
| `SKPORT_PASSWORD` | Yes | SKPORT password. |
| `PUPPETEER_HEADLESS` | No | `true` or `false`. Default is `false`. |
| `PUPPETEER_DISABLE_SANDBOX` | No | `true` or `false`. Default is `false`. |
| `PUPPETEER_EXECUTABLE_PATH` | No | Path to Chromium/Chrome executable. |
| `PUPPETEER_USER_DATA_DIR` | No | Browser profile directory. Default is `./.cache/puppeteer-profile`. |
| `TIMEOUT_MS` | No | Timeout in milliseconds for login/token checks. Default is `15000`. |

Example:

```env
SKPORT_EMAIL="your-email@example.com"
SKPORT_PASSWORD="your-password"
REGION="ASIA"
```

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Update `.env`.

3. Start the script:

```bash
node index.js
```

## Run with Docker Compose

Build and start in background:

```bash
docker compose -f compose.yml up -d --build
```

View logs:

```bash
docker compose -f compose.yml logs -f
```

Stop service:

```bash
docker compose -f compose.yml down
```

The Compose setup stores Puppeteer profile data in a named volume (`skport_cache`) so login state can persist across restarts.

## Notes

- First run executes an immediate check-in, then continues on a daily schedule.
- If captcha appears, the script cannot solve it automatically.
- Container timezone is chosen by `REGION` in `compose.yml`:
  - `ASIA` -> `Asia/Singapore`
  - `AMERICAS` or `EUROPE` -> `America/New_York`

## Security

- Keep `.env` private and never commit real credentials.
- Change credentials if they are exposed.