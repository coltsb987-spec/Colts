# Publishing checklist (print this or keep it open)

Nothing gets published automatically. **You** upload every video yourself.

## Before upload - the script
- [ ] `python3 factory.py check <id>` says READY TO APPROVE
- [ ] Every factual claim has a source you've opened yourself today (tool prices and free plans change)
- [ ] No income promises, no invented results, no fake testimonials
- [ ] Any personal story is true (and listed in `config/settings.json` -> `true_facts_about_me`)
- [ ] Affiliate link or paid deal? The caption **starts** with "Ad" / "#ad" (see `docs/compliance_uk.md`)

## Before upload - the video
- [ ] `python3 factory.py qc 07_edited_videos/<id>_final.mp4` says PASS
- [ ] Watched start to finish **with sound**: lip-sync OK, face looks like you, no glitches
- [ ] Captions spelled correctly and not hidden behind the like/comment buttons
- [ ] First 1-3 seconds: the hook is clear even with the sound off
- [ ] No music you don't have the rights to (use each app's built-in licensed music library)
- [ ] No third-party logos, screenshots of private messages, or other people's faces without permission

## Instagram Reels (phone app)
Open `08_captions_thumbnails/<id>/instagram_post.txt`.
1. Send the final MP4 to your phone (AirDrop, Google Drive, WhatsApp to yourself)
2. Instagram -> **+** -> **Reel** -> select the video -> Next
3. Optional: add trending audio from Instagram's library at low volume (10-15%) under your voice
4. **Edit cover**: choose an expressive frame or upload a cover, and check the square grid crop
5. Paste the caption (it already includes the hashtags)
6. **Advanced settings** -> turn on **AI label** (your digital twin is AI-generated)
7. Paid partnership / affiliate: turn on **Paid partnership label** and start the caption with "Ad"
8. Share -> copy the post link

## YouTube Shorts (phone app)
Open `08_captions_thumbnails/<id>/youtube_post.txt`.
1. YouTube app -> **+** -> **Short** -> upload the video
2. Title = the title line. Paste the description into "Description".
3. Pick the best cover frame if the app offers it
4. **Altered or synthetic content** -> **Yes**
5. Paid promotion -> tick only if it's an ad or affiliate
6. Audience: "No, it's not made for kids"
7. Upload -> post the pinned comment and pin it -> copy the link

## After upload
- [ ] `python3 factory.py published <id> --platform instagram --url <link>`
- [ ] `python3 factory.py published <id> --platform youtube --url <link>`
- [ ] Reply to comments in the first hour (keep any promise the CTA made)
- [ ] After **48 hours**: fill in the numbers in `10_analytics/content_tracker.csv`
- [ ] After **7 days**: update the numbers, then run `python3 factory.py weekly`

## Where the numbers are
- **Instagram:** open the Reel -> **View insights** (needs a free Professional account:
  Settings -> Account type and tools -> Switch to professional). Plays, average watch time,
  likes, comments, shares, saves, profile activity, follows.
- **YouTube:** YouTube Studio app -> Content -> the Short -> Analytics. Views, average view
  duration, "viewed vs swiped away", likes, comments, shares, subscribers gained.
