# Lead Finder

Finds local businesses that have no proper website. These are businesses with no website at all, only a Facebook or
Instagram page, only a booking page (Fresha, Booksy…), only a directory listing (Yell, Checkatrade…), or a website
that is broken or out of date. It saves them to a database and ranks them by how likely they are to buy.

**Status: Stage one is done.** You can search by town and radius, the leads are saved, and every past search is kept.
Stages two to five (contact details, map and call tracking, site builder, emails) come next, one at a time.

## Try it free first (demo mode)

Demo mode uses made-up businesses. It needs no key and costs nothing.

```
python3 -m leadfinder --demo serve
```

Then open http://127.0.0.1:8765 in your browser.

## Using it for real

1. **Get a Google key** (one-off, about 10 minutes):
   - Go to https://console.cloud.google.com, create a project and add a billing account.
   - In "APIs & Services → Library", enable **Places API (New)** and **Geocoding API**.
   - In "APIs & Services → Credentials", create an **API key**. Under "API restrictions", allow only those two APIs.
   - **Set a budget alert** in Billing → Budgets & alerts (for example £10/month). You can also lower the daily
     quota for Places API under "Quotas", so a mistake can never run up a big bill.
2. Put the key in the `.env` file in the main folder (copy `.env.example` if you have none):
   `GOOGLE_MAPS_API_KEY=your-key-here`. Never paste it anywhere else.
3. Run `python3 -m leadfinder serve`. Type a town, pick a radius and a business type, and press **Check cost**.
   The tool shows the most a search can cost. Nothing is spent until you press **Yes, run this search**.

The command line works too:

```
python3 -m leadfinder estimate Ilford 3 barbers     # cost only, spends nothing
python3 -m leadfinder search Ilford 3 barbers       # asks "yes" before spending
python3 -m leadfinder searches                      # every past search
python3 -m leadfinder leads 4 --csv ilford.csv      # leads from search #4, as a spreadsheet
```

## What it costs

Each search piece is one Google "Text Search" request. At Google's list price this is about **$35 per 1,000**,
because asking for phone numbers, websites and ratings uses the dearer "Enterprise" tier. Looking up a town is about
$5 per 1,000, and each town is only looked up once. Google gives a monthly free allowance, so light personal use may
cost nothing. Check the current prices at https://mapsplatform.google.com/pricing/ and update the numbers in
`settings.json`. The numbers there are only used to show you estimates.

Rough guide: 3 miles, one business type = 9 tiles = about 9–20 requests = **$0.30–$0.70**.
A search can never use more than `max_requests_per_search` (300, about $10.50). A search that would need more is
refused before anything is spent.

## How it works

- **Tiles:** the circle is cut into squares about 2 miles across. Google returns at most 60 results per search,
  so any square that comes back full is cut into 4 smaller squares and searched again, up to 3 times. This way
  busy high streets don't hide leads.
- **Website check:** if a business lists a website, the tool opens its home page itself (this is free). It marks the
  site *broken* if it won't load, has expired or is parked. It marks it *outdated* if it has no https, isn't
  mobile-friendly, or shows a copyright date 3 or more years old. Businesses with a working, current site are saved
  but hidden from the lead list.
- **Score (0–100):** more Google reviews, a good rating, "open for business", a listed phone number, listed hours
  and the kind of website problem all add points. Hover over a score to see why it got that number. It's a guess
  to help you decide who to ring first, not a fact.
- **No duplicates:** each business is stored once, by its Google ID, and also matched on name and phone number.
  Searching an overlapping area links the same record again. Your call notes and status are never overwritten.

## Personal data (UK GDPR)

The database is `leadfinder/data/leads.sqlite`. It stays on your computer, git never uploads it, and the web app only
listens on your own machine (127.0.0.1). It only stores what Google lists publicly. Before you start ringing
businesses, read the ICO's guidance on "legitimate interests" for business-to-business calls, and check numbers
against the TPS/CTPS do-not-call lists. Sole traders count as individuals.

## Settings (`settings.json`)

| Setting | Meaning |
| --- | --- |
| `tile_miles` | Size of the first search squares |
| `max_split_depth` | How many times a full square can be split |
| `max_requests_per_search` | Hard spending limit per search |
| `check_websites` | Open each listed website to see if it's broken or old |
| `outdated_after_years` | A copyright year this old or older counts as outdated |
| `business_types` | The drop-down list, and the words searched on Google |
