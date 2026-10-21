# AI Business Influencer Factory - rules for Claude Code

This repo is a content production system for the owner's Instagram Reels and YouTube Shorts about
AI, online business and making money ethically. The owner is a beginner: explain actions simply.

## Hard rules
- **Never publish**, post, message, or change the owner's social accounts. Never spend money or
  Higgsfield credits without first quoting the exact cost and getting an explicit "yes" in chat.
- Never invent personal experiences, income figures, client stories, testimonials or results.
  Personal facts may only come from `config/settings.json` -> `creator.true_facts_about_me`.
- No income guarantees or "get rich" framing. Every factual claim goes in the script's `claims`
  list as `verified` (with a source you actually opened), `opinion`, or `needs_verification`.
- Don't copy or closely imitate other creators' scripts or catchphrases. Learn structure only.
- Don't scrape Instagram or bypass logins or rate limits. Research is manual or via the official Graph API.
- Never write API keys or tokens into files other than `.env` (git-ignored). Never print them.
- Only the owner approves scripts: `python3 factory.py approve <id> --by "<owner name>"`, run only
  when the owner says so.

## How to do common tasks
- **Daily ideas:** `python3 factory.py ideas`, then summarise the 10 ideas for the owner.
- **Write a script:** follow `prompts/write_script.md`. Save the JSON to `03_scripts/`, then run
  `python3 factory.py check <id>` and fix every error before showing the owner.
- **Research from notes or screenshots:** follow `prompts/research_from_notes.md`. Append to
  `01_research/research_log.csv`, then run `python3 factory.py research`.
- **Make a video:** follow the script's `05_higgsfield_prompts/<id>_higgsfield.md`. If the Higgsfield
  integration is connected, upload the owner's photo and voice files, quote costs, wait for approval,
  generate, download clips to `06_raw_videos/<id>/segNN.mp4`, then `python3 factory.py assemble <id>`.
- **Weekly review:** `python3 factory.py weekly`, then explain the results in plain English.
  Hypotheses, not facts.

## Checks before committing
`python3 -m unittest discover tests` must pass.
