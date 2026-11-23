# Deploy Fathom

The demo needs three things that stay up together: the Next.js app, the in-process watch worker, and Postgres. A serverless host drops the worker between requests, so the indexer never finishes heimdall. Render runs the Docker image as one web service and attaches a free Postgres database. That is the path below.

There is no public URL yet. Publishing needs a Render account, which this environment does not have.

## What a judge gets

On first boot, `SEED_DEMO=true` (the Blueprint default) queues four contracts if they are not already watched:

| Contract | Chain | Address |
| --- | --- | --- |
| WETH | Ethereum | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| Unverified | Ethereum | `0x43f3c2464359f30025fa0374a0f080a7e24aafa8` |
| Aave V3 Pool | Ethereum | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` |
| USDC | Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

Indexing uses the public RPCs in `render.yaml`. No API keys are required. The unverified contract is the slow one: heimdall runs once, usually under a minute, and the row stays on `Decompiling with heimdall` until it finishes. After that, the watchlist is ready and a judge can paste any other address.

Set `SEED_DEMO=false` to start with an empty watchlist.

## One-time steps

1. Create a Render account at https://dashboard.render.com/register (GitHub login is enough).
2. Push this repo to a Git host Render can read. The Origin remote works if you connect it, or mirror to GitHub.
3. In the Render dashboard, choose **New → Blueprint**.
4. Select the repo and branch. Render reads [`render.yaml`](render.yaml) from the root.
5. Apply the Blueprint. Render builds the Dockerfile, creates the free Postgres database named `fathom-db`, and sets `DATABASE_URL` from that database. You do not paste a connection string.
6. When the deploy is live, open the service URL (`https://fathom.onrender.com` or whatever name Render assigns).

That is the whole setup. There is no Render API token to put in the repo.

## What you will be asked for

| Prompt | What to enter |
| --- | --- |
| Render login | Your account. GitHub OAuth is the usual path. |
| Blueprint repo | This repository. |
| Service name | Leave `fathom`, or rename it. The public URL uses that name. |

Do not add `ETHERSCAN_API_KEY` or `TELEGRAM_BOT_TOKEN` unless you want those extras. The demo runs without them.

## After it is up

- First request after 15 idle minutes waits about a minute while the free instance wakes. Render shows its own loading page during that time.
- The four demo rows appear immediately as `queued`, then move to `ready` as the worker finishes. WETH, Aave, and USDC are fast. The unverified contract waits on heimdall.
- Health check: `https://<your-host>/api/health` returns `{ "ok": true }`.
- Paste a new address on the home page. The same worker indexes it.

## Free-tier limits

- **512 MB RAM and 0.1 CPU** on the free web instance. Heimdall on the unverified demo fits in a short run here, but a much larger contract can run the process out of memory. If the unverified row stays on `error` with an out-of-memory log, change the web service plan from `free` to a paid plan with at least 2 GB (the `standard` 2 GB plan, or any larger one) and redeploy.
- **Spin-down.** A free web service sleeps after 15 minutes without a request. The worker stops with it. Indexed rows stay in Postgres. The next visit wakes the process, which resumes the queue and does not re-index contracts that are already `ready`.
- **750 free instance hours per workspace per month.** One always-awake service would exceed that. Sleeping between visits stays inside it. For the ETHGlobal floor, open the URL once in the morning so the first judge does not wait on a cold start, or upgrade the web service to a paid always-on plan.
- **Free Postgres expires 30 days after creation** and is limited to 1 GB, one free database per workspace. Create it in the first days of December, or move `fathom-db` to a paid plan before the 30 days end. The data is the watchlist, not the chain.
- **Ephemeral disk.** Generated Ponder files under `/app/generated` disappear when the instance sleeps or redeploys. The dashboard reads the copy stored in Postgres, so the Indexer tab still shows the config.
- **Public RPCs** rate-limit `eth_getLogs`. The seed uses an 80-block window and at most 100 logs per contract. The live tail stops after `INDEX_MAX_LOGS * 4` stored logs so a busy token cannot fill the free database.

## If you would rather not use Render

Fly.io and Railway can run the same Dockerfile plus a Postgres database. Both need an account and a CLI token (`fly auth login` or a Railway project token). The worker and the web app must be the same long-running process. Do not put only the web app on Vercel: the indexer would not stay running, and the heimdall binary is not available on serverless.
