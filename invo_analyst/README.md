# Invo Top 10 Trade Analyst

This tool watches the top traders on Invo. When one of them makes a move, it tries to work out
the likely reason and sends you a short note on Telegram or by email.

**Research only.** It cannot place trades. The code refuses any Invo address that could open, change or
close a trade, and it never touches your money. It only reads data.

> These traders use leverage and can lose money fast. Their past results don't guarantee future ones.
> The explanations are informed guesses from public price data. They don't know what the trader was
> actually thinking.

---

## What it does, every few minutes

1. Gets the list of traders to watch (see "Where the top 10 comes from" below).
2. For each trader, reads their open trades and recent closed trades from Invo (2 requests per trader).
3. Spots what changed: **opened**, **closed**, **size changed**, **leverage changed**.
4. For a new trade, it collects:
   - **Price action** on that coin from Hyperliquid, where Invo trades actually happen: trend, 3-day
     support and resistance, breakout or pullback, volatility, and volume against normal.
   - **Market context:** what BTC is doing, the funding rate, open interest, and how many big coins are up.
   - **The trader's habits:** their usual coins, leverage, position size, holding time and win rate,
     plus whether this trade fits those habits.
   - **The trader's own words**, if Invo shows any (see the limits section below).
   - **Clusters:** whether other watched traders are on the same coin and side.
5. Claude turns that evidence into a 2 to 3 sentence reason labelled **high**, **medium** or **low**
   confidence. When the reason isn't clear, it says so plainly.
6. When a trade closes, you get the result, how long it was held, and whether the original reasoning
   played out.
7. Once a day you get a summary: who traded what, where traders agree, patterns, what seems to be
   working, and a risk reminder.

Everything is saved in `data/analyst.db` (SQLite), so you can look back later.

---

## Setup (about 20 minutes)

You need a computer that stays on. A cheap cloud server (about $5/month) works, and so does an old laptop.

### Step 1: install

```sh
cd Colts/invo_analyst
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
cp config.example.json config.json
```

### Step 2: your Invo login token

Invo has no official API. This tool uses the same private API the Invo website uses, logged in as you.
You copy your login token once, and it lasts about a year.

1. Log in at https://app.invoapp.com in Chrome or Firefox **on a computer**.
2. Press **F12** to open DevTools, then click the **Network** tab.
3. In the filter box, type `refresh_token`. Log out and back in, or wait about 10 minutes, until a
   request shows up.
4. Click that request. Under **Request Headers**, find `Authorization: Bearer eyJ...`.
5. Copy everything after `Bearer ` and paste it into `.env` as `INVO_REFRESH_TOKEN=eyJ...`.

Treat this token like a password. `.env` is git-ignored, so it is never committed. Don't paste it into chats.

### Step 3: tell it which traders to watch

**Start with ONE trader (dry run).** Open the Invo leaderboard, click the #1 trader, and copy the
page address. It looks like `https://app.invoapp.com/portfolio/6053206f-...`. Paste it into
`config.json` under `leaderboard.portfolio_ids`. Keep `"dry_run_single_trader": true`.

### Step 4: alerts (Telegram is easiest)

1. In Telegram, message **@BotFather**, send `/newbot`, and follow the steps. It gives you a token.
   Put it in `.env` as `TELEGRAM_BOT_TOKEN`.
2. Send any message to your new bot, then open
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser. Find `"chat":{"id":12345...`
   and put that number in `.env` as `TELEGRAM_CHAT_ID`.
3. For the AI explanations, add `ANTHROPIC_API_KEY` from https://console.anthropic.com. This costs
   money per explanation, so see "Costs" below.

### Step 5: check, then run

```sh
python3 invo.py check        # logs in, reads the trader, shows their open trades
python3 invo.py test-alert   # you should get a Telegram message
python3 invo.py once         # one cycle (the first cycle records existing trades silently)
python3 invo.py run          # keep running; Ctrl-C to stop
```

Once it has run well for a day or two on one trader, scale up: paste all 10 IDs into `portfolio_ids`
and set `"dry_run_single_trader": false`.

To keep it running after you log out, use `invo-analyst.service`. Instructions are inside the file.

---

## Where the "top 10" comes from

Invo doesn't document a leaderboard API, and none of the open-source Invo projects call one, so there
are three options (`config.json` → `leaderboard.mode`):

| mode | How it works | Effort |
|---|---|---|
| `manual` (default) | You paste the top-10 portfolio links from the leaderboard page | Re-paste when the ranking changes |
| `followed` | You **follow** the top 10 in the Invo app. The tool reads your followed list and ranks it by `rank_by` (for example `plSnapshot` or `winRate`) | Follow or unfollow in the app |
| `endpoint` | Fully automatic. Open the leaderboard page with DevTools → Network, find the request that loads the list, and copy its path (e.g. `/v1_0/...`) into `endpoint_path` and its JSON body into `endpoint_body` | One-time copy. Paths with trade words are refused for safety |

---

## Settings (`config.json`)

| Setting | Meaning |
|---|---|
| `dry_run_single_trader` | `true` = watch only the first trader |
| `num_traders` | How many to watch (max 10) |
| `poll_interval_seconds` | Time between checks. Minimum 120, default 300 (5 min) |
| `alert_channel` | `telegram`, `email` or `console` |
| `alert_on_existing_positions_at_start` | `false` = trades already open when the tool starts are recorded, not alerted |
| `min_size_change_pct` | Ignore size changes smaller than this (%) |
| `close_confirm_polls` | A trade missing this many checks in a row counts as closed (if it's not in the closed list yet) |
| `cluster_min_traders` / `cluster_window_hours` | When to flag "several traders agree" |
| `daily_summary_hour_utc` | When the daily summary is sent (UTC hour) |
| `claude.model` / `claude.effort` / `claude.max_calls_per_day` | AI settings and a daily cap on AI calls |

## Being gentle with Invo

- Invo allows about 250 requests per 5 minutes per IP address. This tool caps itself at **60** (the
  `INVO_RATE_LIMIT` setting).
- 10 traders checked every 5 minutes is about 20 requests per 5 minutes, plus a history read per
  trader about twice a day.
- When Invo replies "too many requests", the tool waits and slows down.

## When something breaks

- **Login expired or rejected:** you get **one** alert with the fix (repeat Step 2). It retries every
  15 minutes.
- **Invo changed its API:** you get **one** "DATA FEED PROBLEM (api_changed)" alert. It keeps
  retrying, and you get "DATA FEED RESTORED" when data flows again. The file to update is
  `analyst/invo_client.py`.
- **Invo unreachable 3 cycles in a row:** one alert.
- A failed check **never** counts as "trade closed", so you won't get fake close alerts.
- Every move is saved before the alert is sent. If sending fails, it is retried next cycle.

Useful commands: `python3 invo.py status`, and the log at `data/analyst.log`.

## Costs

- Invo, Hyperliquid data and Telegram: free.
- Claude: each new trade or close is one request. Rough estimate: a few US cents per explanation on
  the default model (`claude-opus-5-5`, $4 / $20 per million input/output tokens). Each request
  sends roughly 2–4k tokens and gets a few hundred back, plus thinking. `max_calls_per_day`
  (default 200) caps the spend. To spend nothing, set `claude.enabled` to `false`. Alerts then say
  "not analysed".
- The AI calls use Anthropic's server-side fallback. If the main model declines a request, another
  model answers it in the same call.

## Honest limits

- **No news feed** is connected. There's no free, reliable one without a key. Claude is told this
  and won't claim a news reason unless the trader's own post says so.
- **Trader posts and comments:** no public project has found a reliable Invo endpoint for these. The
  social feed is known to be buggy. The tool uses any text Invo attaches to the trade itself. If you
  find the comments request in DevTools, put it in `posts.endpoint_path` and use `{portfolioId}`
  inside `posts.endpoint_body`.
- **Open interest** is a current snapshot. Its change over time isn't available for free.
- **Returns** are worked out as price move × leverage. Fees and funding aren't included, and dips
  during a trade aren't visible.
- **Size** is Invo's `entrySize`: margin as a % of the trader's balance, not a dollar amount.
- **Timing:** you hear about a trade up to one poll interval (5 min) after it happens.

## Tests

```sh
python3 -m unittest discover -s tests     # 31 offline tests, no network or keys needed
```

## Credits

The Invo endpoints and refresh-token flow come from
[cforecki/invo-copytrader](https://github.com/cforecki/invo-copytrader) and
[plungarini/invo-sentinel](https://github.com/plungarini/invo-sentinel). They were studied for
patterns, and none of their trading code is used here.
