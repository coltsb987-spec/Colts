# Prompt: turn your research notes into the research log

When you watch a creator's Reels, jot quick notes, or take screenshots of the public Reel page
(not of anything behind a login you shouldn't use). Then paste into Claude Code:

---

Here are my notes on public Reels from @USERNAME. Add one row per video to
`01_research/research_log.csv` following `config/research_fields.md`:
- paraphrase the hook (don't copy it word for word)
- choose the category and hook_type codes
- only include numbers I've given you; leave the rest blank
- source = manual

Then run `python3 factory.py research` and tell me the three most useful patterns, labelled as hypotheses.

NOTES:
(paste here)

---

## Monthly creator review (optional)
"Read `01_research/reports/` and my `10_analytics/reports/`. What are other creators covering that
my audience responds to, and what gap could I fill with an original angle? Give me 5 original video ideas,
labelled as hypotheses."
