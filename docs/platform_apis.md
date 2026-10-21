# Platform APIs - what can and can't be automated

Researched 21 Oct 2026. These platforms change often, so check the official docs before building on them.

## Summary

| Task | Automated now? | Why / what's needed |
|---|---|---|
| Researching other creators on Instagram | **Manual** by default. Optional API. | Instagram has no open public API. The official *Business Discovery* endpoint of the Instagram Graph API can read public like/comment counts and captions of other **Business/Creator** accounts. It needs your own Professional account linked to a Facebook Page, a Meta developer app and an access token. It does **not** give other accounts' view counts. Scraping and logged-in automation break Instagram's terms, so this project doesn't do them. |
| Publishing to Instagram | **Manual** (recommended for now) | The Instagram Graph API can publish Reels (`media_type=REELS`). It needs a Professional account, a Meta app, the `instagram_business_content_publish` permission, and the video hosted at a public URL. Worth setting up after about 20 posts if uploading becomes a chore. |
| Publishing to YouTube | **Manual** (recommended for now) | The YouTube Data API `videos.insert` can upload. It needs a Google Cloud project and OAuth consent. Uploads from unverified API projects may be locked to private until the project passes Google's audit. |
| Higgsfield video generation | **Assisted.** Claude Code can run it through the Higgsfield integration when connected, with your approval of each credit spend. | Verified in this session. |
| Captions, assembly, quality checks | **Automated**, locally with FFmpeg | `factory.py assemble / burn / qc` |
| Analytics | **Manual entry** into a CSV | Instagram Insights and YouTube Studio both have APIs, but they need the same app setup as publishing. Typing 9 numbers per video takes about 2 minutes. |

## Optional: Instagram research via the official API (`factory.py research-fetch`)
Only do this if you're comfortable with developer settings. You need:
1. An Instagram **Professional** account (free: Settings -> Account type and tools)
2. A Facebook **Page** linked to it
3. A Meta developer app (developers.facebook.com) with Instagram Graph API access
4. Your IG user ID and a long-lived access token from the Graph API Explorer

Copy `.env.example` to `.env` and fill in `IG_USER_ID` and `IG_ACCESS_TOKEN`. The `.env` file is
git-ignored. Never paste tokens into chat, scripts or other files. Then run:

```bash
python3 factory.py research-fetch
```

This adds rows (likes, comments, links, dates) to `01_research/research_log.csv`. You still fill
in category, hook and structure by watching the videos. It only works for creators with
Business/Creator accounts, makes one request per creator, and waits 1 second between requests.
The code has been tested against a sample API response, **not** against the live API, because no
token is configured yet.

## Sources
- Instagram content publishing: https://developers.facebook.com/docs/instagram-platform/content-publishing
- Instagram Graph API (Business Discovery): https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
- YouTube Data API upload: https://developers.google.com/youtube/v3/docs/videos/insert
