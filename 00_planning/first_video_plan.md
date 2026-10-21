# Your first video: "AI won't make you money. Here's what will."

## Why this script was chosen from the five samples

| Script | Length | Strength | Risk | Verdict |
|---|---|---|---|---|
| **AI won't make you money** | 39s | Contrarian hook, sets your brand position ("the honest one"), 3 numbered steps + example, broad audience | No factual claims to verify | **Chosen: best first video** |
| Nobody wants to buy AI | 29s | Very punchy hook, comment-driving CTA | Narrower audience (people already selling AI services); you must reply to comments | Second |
| Sell one finished thing | 37s | Very practical, saveable | Less distinctive hook | Third |
| AI replies for local businesses | 33s | Concrete business idea | CTA promises a follow-up "how to" video you'd need to make next | Good as video 2 + 3 pair |
| 48-hour idea test | 37s | Strong save potential | Has a claim that **needs verifying** on filming day (free website builder plan) | After you check the claim |

Reasoning (a hypothesis, not a guarantee): your first video should tell new viewers *why
to follow you* rather than another "make money with AI" account. This one does that and needs no
fact-checking, so you can make it today.

## The complete production package

| What | File |
|---|---|
| Script (structured) | `03_scripts/2026-10-21_ai-wont-make-you-money.json` |
| Readable script + teleprompter | `03_scripts/2026-10-21_ai-wont-make-you-money.md` |
| Higgsfield prompts, recording lines, settings | `05_higgsfield_prompts/2026-10-21_ai-wont-make-you-money_higgsfield.md` |
| Captions file | `08_captions_thumbnails/2026-10-21_ai-wont-make-you-money/captions.srt` |
| Instagram caption, cover text, labels | `08_captions_thumbnails/2026-10-21_ai-wont-make-you-money/instagram_post.txt` |
| YouTube title, description, labels | `08_captions_thumbnails/2026-10-21_ai-wont-make-you-money/youtube_post.txt` |
| Cover / thumbnail brief | `08_captions_thumbnails/2026-10-21_ai-wont-make-you-money/thumbnail_brief.md` |
| On-screen text list (for editing) | `08_captions_thumbnails/2026-10-21_ai-wont-make-you-money/on_screen_text.txt` |
| Where the Higgsfield clips go | `06_raw_videos/2026-10-21_ai-wont-make-you-money/seg01.mp4` ... `seg04.mp4` |

## Make it today - step by step (about 1-2 hours the first time)

1. **Read and approve the script (10 min).** Open the readable script. Change any words that don't sound
   like you, then run:
   `python3 factory.py check 2026-10-21_ai-wont-make-you-money` and
   `python3 factory.py approve 2026-10-21_ai-wont-make-you-money --by "Your Name"`
2. **Take your start photo (10 min).** Follow `docs/digital_twin_workflow.md` step 1.
3. **Record 4 voice memos (10 min).** The text for each is in the Higgsfield file. Name them `voice_01.m4a` to `voice_04.m4a`.
4. **Test one clip at 720p (about 15 credits).** In Higgsfield: Wan 2.7, your photo as the start image,
   `voice_01.m4a` as the audio, 9:16. Paste the Clip 01 prompt. Happy with it? Do all 4 at 1080p
   (about 100 credits in total).
5. **Download** the 4 clips and save them as `seg01.mp4` to `seg04.mp4` in the raw videos folder above.
6. **Assemble:** `python3 factory.py assemble 2026-10-21_ai-wont-make-you-money`
7. **Watch** `07_edited_videos/2026-10-21_ai-wont-make-you-money_final.mp4` with sound on.
8. **Publish** with `docs/publishing_checklist.md`, then log it with `python3 factory.py published ...`

**Shortcut:** skip steps 2-5 and film yourself reading the script on your phone (Route C, 0 credits),
then run `python3 factory.py burn 2026-10-21_ai-wont-make-you-money --video yourvideo.mp4`.
