# Prompt: write a script

Copy this into Claude Code (replace the parts in CAPITALS):

---

Write an original 20-45 second script for idea NUMBER in today's `02_ideas/ideas_DATE.md`.

Follow `docs/script_style_guide.md` and `CLAUDE.md`. Use the JSON format in
`templates/script_template.json` and save it as `03_scripts/DATE_short-slug.json`.

Requirements:
- A hook under 12 words, a problem, 2-4 useful points, a practical example, and a CTA
- On-screen text and a visual note for every beat
- Instagram cover text, caption and CTA; YouTube title, description, CTA and pinned comment
- 3-8 relevant hashtags (no stuffing)
- Every factual claim listed in `claims` with a source, or labelled opinion. If you look up a source,
  open it and confirm it says what you claim.
- My voice: see `config/settings.json`. Only use personal facts from `true_facts_about_me`.
- No income promises, no invented results.

Then run `python3 factory.py check <id>`, fix every error, and show me the script as a readable table.

---

## Variations
- "Write 3 alternative hooks for `<id>` using different hook types, and tell me which you'd test first and why."
- "Make `<id>` 10 seconds shorter without losing the example."
- "Turn this voice note / these notes into a script: ..." (paste your own thoughts. These make the most original scripts.)
