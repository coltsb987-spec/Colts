# Script style guide

Every script is a JSON file in `03_scripts/` (template: `templates/script_template.json`).
`python3 factory.py check` enforces the rules marked **(checked)**.

## Structure (20-45 seconds at about 2.6 words per second, 50-115 words)
1. **Hook** - 1-3 seconds, under 12 words **(checked)**. A contrarian line, a sharp question, a
   mistake warning, or a surprising result. Works with the sound off (on-screen text says it too).
2. **Problem / curiosity gap** **(checked)** - name the viewer's frustration in their words.
3. **2-4 useful points** **(checked)** - numbered, one idea each, one sentence each if possible.
4. **Practical example** (strongly recommended) - make it concrete with a named type of business,
   a real prompt, or a before/after.
5. **CTA** - last beat **(checked)**. One ask only: follow, save, comment a word, or share.

Each beat also needs **on-screen text** (max about 6 words) and a **visual** note **(checked)**.

## Voice
- UK English, plain words, short sentences, contractions. Talk to one person ("you").
- Honest about effort. "This takes work, but..." builds trust.
- First person **only** for things that are true and listed in `config/settings.json` ->
  `true_facts_about_me`. Otherwise use "here's what I'd do", "you could", "for example".

## Never (all checked automatically where possible)
- Income guarantees, "get rich", "risk-free", "overnight", "anyone can" **(checked)**
- Personal results or client stories that aren't true **(checked: blocked unless you confirm them)**
- Statistics without a source **(claims must be `verified` with a source, or labelled `opinion`)**
- Copying another creator's script, catchphrase or distinctive format word for word
- More than 8 hashtags, or irrelevant trending tags **(checked)**

## Claims
List every factual statement in `claims`, each with a status:
- `verified` - you opened the source and it supports the claim (source URL required)
- `opinion` - clearly framed as opinion or advice
- `needs_verification` - **blocks approval** until checked

## Hook types (pick one per script - `hook_type`)
question, bold_claim, mistake_warning, list_number, story, demo_result, contrarian, curiosity_gap, before_after.
Vary them, then let the weekly report show which work for *your* audience.
