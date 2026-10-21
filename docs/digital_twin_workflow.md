# Your AI digital twin - Higgsfield workflow

## What was actually checked (21 Oct 2026)

Claude Code checked your Higgsfield account through the connected Higgsfield integration, using
**read-only** checks plus free price quotes. Nothing was generated and no credits were spent.

| Item | Finding |
|---|---|
| Plan / credits | Ultra plan, about 2,257 credits |
| Trained digital twin (Soul character) | **None yet** |
| Saved reference Elements (your face) | **None yet** |
| Custom voice (your voice clone) | **None yet** (only Higgsfield's preset voices) |
| Lip-sync to your own audio | Available: **Wan 2.7** (start photo + audio, 2-15s, 9:16, 720p/1080p) and **Seedance 2.5** (image + audio references, 4-30s, up to 1080p) |
| Voice cloning | Available: *Create Voice* (record or upload your voice). Then text-to-speech with your voice. |
| Vertical 9:16 output | Supported by both lip-sync models |
| Export | Download each finished clip from your Higgsfield library (or ask Claude Code to fetch it) |
| Price quotes (no media attached) | Wan 2.7: **25 credits / 10s at 1080p**, 15 credits / 10s at 720p. Seedance 2.5: **208 credits / 13s at 1080p** |

**Not yet verified:** how realistic the lip-sync looks with *your* face and voice. You can only find
that out with a first test clip (step 4 below). Prices may change. Higgsfield shows the price before every generation.

**Budget guide:** one 40-second video made with Wan 2.7 at 1080p costs about 100 credits, plus any
re-generations. Use 720p for tests.

---

## The three routes to a finished video

| Route | How it works | Credits | Best for |
|---|---|---|---|
| **A. Your real voice + your photo (recommended)** | You record the script on your phone. Higgsfield animates your photo to lip-sync to your recording. | ~100 per video | The most authentic voice. Use this by default. |
| **B. Your cloned voice + your photo** | Higgsfield clones your voice once. After that, scripts are read by your cloned voice. | Video cost plus a small audio cost | Days you can't record. Check it sounds like you first. |
| **C. Film yourself on your phone** | No AI video at all. Use `python3 factory.py burn <id> --video yourclip.mp4` for captions. | 0 | The cheapest and most trusted option. Great for build-in-public videos. |

All three use the same scripts, captions and posting packs.

---

## One-time setup (about 30-45 minutes)

### 1. Take your start photos (free)
Take 5-10 photos on your phone's rear camera. These rules make or break realism:
- Face the camera, eyes looking into the lens, **mouth closed with a relaxed natural expression**
- Chest-up framing, **vertical** photo, camera at eye level, about an arm's length away
- Soft daylight from a window in front of you. No harsh shadows, no backlight.
- The outfit and background you want on screen (see `config/settings.json` -> `higgsfield.look`)
- No sunglasses, hats, hands near your face, or heavy filters

Choose the sharpest one. That's your **start image** for Wan 2.7.

### 2. Optional: save yourself as a reusable Element
In Higgsfield, create a **Character Element** from your best photo. Elements work with Seedance 2.0,
Kling 3.0 and Cinema Studio. They're useful for B-roll of "you" in other scenes, like walking into a
café. Copy the element ID into `config/settings.json` -> `higgsfield.reference_element_id`.

### 3. Optional: train a Soul character (for thumbnails and stills)
Upload 10-20 varied photos of yourself (different angles, expressions and outfits) to train a **Soul**.
Training takes about 10 minutes. A Soul only works with Higgsfield's Soul *image* models, so use it for
consistent thumbnails and covers, not talking-head video. Put the ID in `higgsfield.soul_id`.

### 4. Run a cheap test clip (about 15 credits)
1. Record yourself reading Clip 01 from any `05_higgsfield_prompts/*_higgsfield.md` file.
2. In Higgsfield, choose **Wan 2.7**. Add your start photo as the start image and your voice memo as
   the audio reference. Settings: 9:16, **720p**, duration = your recording length.
3. Paste the Clip 01 prompt. Check the price shown, then generate.
4. Judge it: do the lips match? Does it look like you? Are there odd teeth, eyes or hands?
   - Good: switch to 1080p for real videos.
   - Stiff or uncanny: try Seedance 2.5 (more expensive), a different photo, or Route C for now.

### 5. Optional: clone your voice (Route B)
In Higgsfield, open **Create Voice**. Record or upload a clean sample of your own voice (quiet room,
natural reading pace). Put the voice ID in `higgsfield.custom_voice_id`. Only clone **your own**
voice, and label the content as AI-generated (see below).

---

## Making each video (Route A)

1. `python3 factory.py approve <script-id> --by "Your Name"` creates
   `05_higgsfield_prompts/<script-id>_higgsfield.md`
2. Record each clip's lines as `voice_01.m4a`, `voice_02.m4a`, and so on (the file lists the text).
3. Generate each clip in Higgsfield with the prompt from the file. Download the results.
4. Save them as `06_raw_videos/<script-id>/seg01.mp4`, `seg02.mp4`, ...
5. `python3 factory.py assemble <script-id>` joins the clips, adds captions and quality-checks.
6. Watch the result in `07_edited_videos/<script-id>_final.mp4` with the sound on.

### Let Claude Code drive Higgsfield for you
When the Higgsfield integration is connected in your Claude Code session, you can upload your photo
and voice files and say:

> Generate the Higgsfield clips for `<script-id>` from my start photo and these voice files.
> Quote the credit cost first and wait for my approval.

Claude Code must quote the cost and wait for your "yes" before every paid generation. It will
never publish anything.

---

## Rules for using your likeness
- Only use **your own** face and voice, or someone who has given written permission.
- Turn on Instagram's **AI label** when posting. On YouTube, answer **Yes** to the "altered or
  synthetic content" question. Realistic AI video of a person needs this, even when it's you.
- Never make your twin say things you wouldn't say on camera yourself. You're responsible for every word.
- Keep your start photos and voice files private. Don't commit them to git (`.gitignore` already
  excludes audio and video files).
