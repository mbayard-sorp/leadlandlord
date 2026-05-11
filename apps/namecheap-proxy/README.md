# namecheap-proxy

Tiny Node HTTP service that forwards Namecheap API calls from Vercel functions
through a fixed-IP host. Solves Namecheap's IP-whitelist requirement on
serverless (Vercel egress IPs rotate).

Vercel function → this proxy (fixed IP) → `api.namecheap.com`

## How it works

- `POST /forward` with header `X-Proxy-Secret: <PROXY_SECRET>`
- Body: `{ "command": "namecheap.domains.check", "params": { ... }, "sandbox": false }`
- Allowlisted commands only; everything else returns 400.
- Response is the raw XML body from Namecheap (passes through status code).
- `GET /healthz` for Fly healthchecks.

## Deploy to Fly.io

Run from this directory (`apps/namecheap-proxy/`).

### 1. Create the app

```bash
flyctl launch --no-deploy --copy-config --name leadlandlord-namecheap-proxy
```

Accept the existing `fly.toml`. Pick a region close to your other infra
(`iad` = us-east, matches Vercel default).

### 2. Allocate a dedicated IPv4

```bash
flyctl ips allocate-v4 -a leadlandlord-namecheap-proxy
```

This is the ~$2/mo charge. Note the IP it prints — you'll whitelist it on
Namecheap and set it as `NAMECHEAP_CLIENT_IP` on Vercel.

If Fly assigned a shared IPv4 by default, remove it:
```bash
flyctl ips list -a leadlandlord-namecheap-proxy
flyctl ips release <shared-ip> -a leadlandlord-namecheap-proxy
```

### 3. Set the proxy secret

Generate a long random string (32+ chars) and set it as a Fly secret:

```bash
flyctl secrets set PROXY_SECRET="$(openssl rand -hex 32)" -a leadlandlord-namecheap-proxy
```

Copy that value — you'll also set it on Vercel as `NAMECHEAP_PROXY_SECRET`.

### 4. Deploy

```bash
flyctl deploy -a leadlandlord-namecheap-proxy
```

### 5. Smoke test

```bash
curl -s https://leadlandlord-namecheap-proxy.fly.dev/healthz
# {"ok":true}
```

## Wire up Vercel

1. **Whitelist the Fly IP on Namecheap**: ap.www.namecheap.com → Profile →
   Tools → API Access → Whitelisted IPs → add the IPv4 from step 2.

2. **Set env vars on Vercel** (production + preview):

   ```bash
   vercel env add NAMECHEAP_PROXY_URL production
   # https://leadlandlord-namecheap-proxy.fly.dev

   vercel env add NAMECHEAP_PROXY_SECRET production
   # paste the same value you set on Fly

   # Update NAMECHEAP_CLIENT_IP to the Fly IPv4
   vercel env rm NAMECHEAP_CLIENT_IP production
   vercel env add NAMECHEAP_CLIENT_IP production
   # paste the Fly dedicated IPv4
   ```

3. **Redeploy**:
   ```bash
   vercel --prod
   ```

4. **Test** — trigger a domain search from the operator UI. Should return
   results without `Invalid request IP`.

## Local dev

The proxy is optional. When `NAMECHEAP_PROXY_URL` is unset, the integration
calls Namecheap directly (current behavior, useful for `NAMECHEAP_DRY_RUN=true`).

To run the proxy locally:
```bash
PROXY_SECRET=test-secret node server.js
```

## Cost

- Dedicated IPv4: $2/mo
- Compute: shared-cpu-1x with `auto_stop_machines` — pennies/month for bursty
  Namecheap calls; idle = $0.
- Total: ~$2–4/mo.

## Security notes

- The proxy refuses any command not in `ALLOWED_COMMANDS` (server.js).
- Auth is a static shared secret via `X-Proxy-Secret` header. Rotate by
  changing both `PROXY_SECRET` on Fly and `NAMECHEAP_PROXY_SECRET` on Vercel.
- Namecheap credentials live on Vercel, not the proxy — the proxy is a dumb
  forwarder. A compromised proxy alone cannot make Namecheap calls.
