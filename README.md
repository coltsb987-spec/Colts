# AI Business Influencer Factory

A small, working system for making Instagram Reels and YouTube Shorts about AI, online business
and making money, presented by your own AI digital twin made in Higgsfield.

**Start here:** `00_planning/first_video_plan.md` takes you through your first video today.

---

## The pipeline

```
Research -> Ideas -> Write script -> Verify claims -> Approve -> Generate video (Higgsfield)
   -> Captions -> Quality check -> Publish (you, by hand) -> Track results -> Weekly review
```

| Step | How | Automated? |
|---|---|---|
| Research 10 creators | Fill in `config/creators.csv` + `01_research/research_log.csv` (or paste notes to Claude Code) | Manual input, automatic analysis |
| 10 daily ideas | `python3 factory.py ideas` | Yes |
| Write script | Ask Claude Code (`prompts/write_script.md`) | Claude Code writes, tool checks |
| Verify claims | Open each source, set claim status to `verified` | Manual (checker blocks unverified claims) |
| Approve | `python3 factory.py approve <id> --by "Your Name"` | Your decision |
| Generate video | Higgsfield, using the generated prompt file | Manual, or Claude Code with your OK on each cost |
| Captions + assemble + QC | `python3 factory.py assemble <id>` | Yes (FFmpeg) |
| Publish | `docs/publishing_checklist.md` | **Manual by design** |
| Track | `python3 factory.py published ...` then type numbers into the tracker | Semi |
| Weekly review | `python3 factory.py weekly` | Yes |

---

## One-time setup on your computer (about 20 minutes)

### 1. Get the files
This project lives in your GitHub repository `coltsb987-spec/Colts`, on the branch
`claude/ai-influencer-factory-z0hhis`. Easiest way: open the repository on github.com, switch
to that branch, click the green **Code** button, then **Download ZIP**. Unzip it somewhere like `Documents/Colts`.
(Or, if you use git: `git clone` the repository and `git checkout claude/ai-influencer-factory-z0hhis`.)

### 2. Install Python 3 (free)
- **Mac:** open Terminal and type `python3 --version`. If it isn't installed, macOS offers to install it.
- **Windows:** install from python.org, and **tick "Add Python to PATH"** during setup. On Windows,
  type `python` instead of `python3` in the commands below.

### 3. Install FFmpeg (free, needed for captions and assembly)
- **Mac:** install Homebrew (brew.sh), then run `brew install ffmpeg`
- **Windows:** open PowerShell and run `winget install ffmpeg`, then close and reopen PowerShell
- Check: `ffmpeg -version` prints a version number

### 4. Check it works
Open a terminal **in the project folder** (Mac: right-click the folder -> New Terminal at Folder.
Windows: open the folder, type `powershell` in the address bar) and run:

```bash
python3 factory.py status
python3 -m unittest discover tests
```

### 5. Personalise
Edit `config/settings.json`: your name, handles, and **true facts about you**. Scripts can only
mention personal experience you list there.

### 6. Set up your digital twin
Follow `docs/digital_twin_workflow.md` (start photo, a test clip, and an optional voice clone).

---

## Daily routine (about 1-2 hours per video once set up)

```bash
python3 factory.py ideas                   # 1. today's 10 ideas -> 02_ideas/
```
2. Ask Claude Code: *"Write a script for idea 3 in today's ideas file"* (see `prompts/write_script.md`)
3. Read it, edit it until it sounds like you, verify any claims, then:
```bash
python3 factory.py check <script-id>
python3 factory.py approve <script-id> --by "Your Name"
```
4. Open `05_higgsfield_prompts/<script-id>_higgsfield.md`, record your voice, make the clips in Higgsfield,
   and save them to `06_raw_videos/<script-id>/seg01.mp4` ...
```bash
python3 factory.py assemble <script-id>    # joins clips, burns captions, quality check
```
5. Upload using `docs/publishing_checklist.md` and the text in `08_captions_thumbnails/<script-id>/`
```bash
python3 factory.py published <script-id> --platform instagram --url <link>
python3 factory.py published <script-id> --platform youtube --url <link>
```
6. After 48 hours, type the numbers into `10_analytics/content_tracker.csv`

**Weekly (Sunday):**
```bash
python3 factory.py research                # if you logged new research
python3 factory.py weekly                  # -> 10_analytics/reports/
python3 factory.py calendar                # -> 00_planning/content_calendar.csv
```

---

## All commands

| Command | What it does |
|---|---|
| `status` | Shows what's set up and what's in the pipeline |
| `research` | Checks the research log and writes a summary report (patterns labelled as hypotheses) |
| `research-import file.csv` | Adds rows from a spreadsheet export to the research log |
| `research-fetch` | Optional: official Instagram Graph API stats (see `docs/platform_apis.md`) |
| `ideas` | 10 content opportunities with audience, problem, hook, reasoning, evidence and CTA |
| `new-script --idea N` | Creates a blank script from an idea, ready to fill in |
| `check [id]` | Checks length (20-45s), structure, hashtags, risky money claims and unverified facts |
| `package id` | Builds a preview production package without approving |
| `approve id --by NAME` | Approves the script and builds its production package |
| `assemble id` | Joins Higgsfield clips, scales to 1080x1920, burns captions, runs the quality check |
| `burn id --video file.mp4` | Adds captions to a single video (for example, one you filmed yourself) |
| `qc file.mp4` | Checks 9:16 shape, resolution, audio, length and loudness |
| `calendar` | Plans the next 14 days of posts from approved and draft scripts |
| `published id --platform ...` | Logs a post you made into the analytics tracker |
| `weekly` | Weekly report: scores retention, shares, saves and follows (not just views) and suggests experiments |

---

## Folders

| Folder | Contents |
|---|---|
| `00_planning/` | First video plan, content calendar |
| `01_research/` | Research log, summary reports, API snapshots |
| `02_ideas/` | Daily idea lists |
| `03_scripts/` | Draft scripts (`.json` = data, `.md` = readable) |
| `04_approved_scripts/` | Scripts you've approved |
| `05_higgsfield_prompts/` | Recording lines + Higgsfield prompts per script |
| `06_raw_videos/` | Clips downloaded from Higgsfield (not stored in git) |
| `07_edited_videos/` | Finished videos with captions (not stored in git) |
| `08_captions_thumbnails/` | Captions, post text and cover briefs per script |
| `09_published/` | Copies of what you published |
| `10_analytics/` | Content tracker CSV + weekly reports |
| `config/` | Settings, creator list, topic bank, research field guide |
| `docs/` | Digital twin, publishing, compliance, monetisation, APIs, style guide |
| `prompts/` | Copy-paste requests for Claude Code |
| `examples/` | **Fictional** practice data |

## Safety rules built in
- Nothing is ever published automatically. You upload by hand.
- Approval is always your decision (`--by` your name).
- The checker blocks income guarantees, invented personal results and unverified claims.
- No Higgsfield credits are spent without a quoted price and your OK.
- Secrets live only in `.env` (git-ignored). The project never asks for passwords.
