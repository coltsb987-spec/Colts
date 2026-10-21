# Research log - what each column means

One row = one public video you watched. File: `01_research/research_log.csv`
(open it in Excel, Google Sheets or Numbers, then save as CSV).

| Column | What to write | Example |
|---|---|---|
| date_logged | Today's date, YYYY-MM-DD | 2026-10-21 |
| creator_username | Their handle without @, must match `config/creators.csv` | examplecreator |
| video_url | Link to the public Reel | https://www.instagram.com/reel/... |
| posted_date | When they posted it, if shown | 2026-10-15 |
| category | One of the 7 category codes below | make_money_with_ai |
| topic | 3-8 words, in your own words | AI tool for writing product listings |
| hook_paraphrase | What the first line *does*, paraphrased, not copied | Asks if viewer is still doing X manually |
| hook_type | One of the hook codes below | question |
| presentation_style | How it is filmed | talking head + screen recording |
| structure | The beats, separated by `>` | hook > problem > 3 steps > CTA |
| length_sec | Approximate length in seconds | 32 |
| cta | What they ask viewers to do | comment a keyword for a guide |
| views / likes / comments / shares / saves | Only numbers that are publicly shown. Leave blank if hidden. | 120000 |
| audience_questions | Questions people ask in comments, separated by `;` | Is it free?; Does it work in the UK? |
| recurring_theme | A theme this creator keeps returning to | side hustles with no upfront cost |
| inspiration_idea | An ORIGINAL idea it gives you (not a copy) | Compare 3 free tools for the same task |
| source | `manual` (or `instagram_graph_api` if fetched) | manual |

## Category codes
- `ai_business_ideas` - AI business ideas
- `make_money_with_ai` - ways to make money with AI
- `beginner_tutorials` - beginner business tutorials
- `business_mistakes` - business mistakes
- `case_studies` - case studies
- `ai_tools_demos` - AI tools and demonstrations
- `entrepreneurship_productivity` - entrepreneurship and productivity

## Hook type codes
`question`, `bold_claim`, `mistake_warning`, `list_number`, `story`,
`demo_result`, `contrarian`, `curiosity_gap`, `before_after`

## Rules
- Only log what is publicly visible without logging into anything you shouldn't.
- Paraphrase hooks. Don't copy scripts, captions or distinctive catchphrases.
- Don't download their videos.
- Hidden numbers stay blank. Never guess them.
