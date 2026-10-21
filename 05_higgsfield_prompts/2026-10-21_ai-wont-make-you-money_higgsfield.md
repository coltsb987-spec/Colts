# Higgsfield production prompts - AI won't make you money. Here's what will.

Script: `2026-10-21_ai-wont-make-you-money` - 4 clip(s) - total ~39s - aspect ratio 9:16 - 1080p

Read `docs/digital_twin_workflow.md` once before your first video. Credits are charged by Higgsfield for every generation: check the price shown before you press Generate.

## Step 1 - Record your voice (free, about 5 minutes)

Record each clip below as a **separate** voice memo on your phone. Quiet room, phone 20 cm from your mouth, speak a little faster and more energetically than normal. Leave half a second of silence at the start and end. Name the files exactly as shown.

**Clip 01 -> `voice_01.m4a`** (~10s, hook, problem)

> AI won't make you money. Here's what will. Most make-money-with-AI videos show you a tool, then skip the hard part: a real person paying you.

**Clip 02 -> `voice_02.m4a`** (~13s, point, point)

> One. Pick a person with a problem. Not 'businesses'. Dog groomers who hate answering messages at night. Two. Sell the result, not the tool. Nobody wakes up wanting AI. They want fewer missed bookings.

**Clip 03 -> `voice_03.m4a`** (~7s, example)

> So instead of 'I do AI automation', try 'I'll make sure every enquiry gets a reply, even after hours.'

**Clip 04 -> `voice_04.m4a`** (~9s, point, cta)

> Three. Ask for money early. One paying customer teaches you more than ten new tools. Follow for the honest version of AI side hustles.

## Step 2 - Generate each talking-head clip in Higgsfield

**Recommended route (your real voice):** model **Wan 2.7 (start image + your audio, up to 15s per clip)**. Upload your start photo as the *start image* and the clip's voice file as the *audio reference*. Aspect ratio 9:16, resolution 1080p, duration = clip length rounded up.

**Alternative if Wan 2.7 looks stiff:** Seedance 2.5 omni-reference (image + audio references, up to 30s) - add the same photo as an *image reference* and the voice file as an *audio reference*, and use the same prompt.

### Clip 01 (10s)

```text
The person in the start image speaking directly to camera, vertical 9:16 medium close-up, chest up, eye-level, phone-camera realism, shallow depth of field. Setting: tidy modern home office, bookshelf and plant softly blurred behind. Wardrobe: plain dark crew-neck t-shirt or overshirt. Lighting: soft key light from the front-left, gentle rim light, natural skin tones. Performance: high energy, leans slightly toward the camera, raised eyebrows, confident direct eye contact; empathetic, slight head tilt, measured pace. Accurate lip-sync to the provided audio, natural blinking, subtle realistic head and shoulder movement, steady framing, no camera cuts. No on-screen text, no captions, no logos, no watermarks, no extra people, hands natural with five fingers.
```

- Audio reference: `voice_01.m4a`
- Save the result as: `06_raw_videos/2026-10-21_ai-wont-make-you-money/seg01.mp4`
- B-roll / edit ideas for this clip (added in editing, not generated): Tight close-up, straight to camera, slight lean in. Hard cut on 'Here's what will'. / Quick scroll of generic AI tool logos, blurred (no real brand logos), then back to face.

### Clip 02 (14s)

```text
The person in the start image speaking directly to camera, vertical 9:16 medium close-up, chest up, eye-level, phone-camera realism, shallow depth of field. Setting: tidy modern home office, bookshelf and plant softly blurred behind. Wardrobe: plain dark crew-neck t-shirt or overshirt. Lighting: soft key light from the front-left, gentle rim light, natural skin tones. Performance: clear and confident, small explanatory hand gestures at chest height. Accurate lip-sync to the provided audio, natural blinking, subtle realistic head and shoulder movement, steady framing, no camera cuts. No on-screen text, no captions, no logos, no watermarks, no extra people, hands natural with five fingers.
```

- Audio reference: `voice_02.m4a`
- Save the result as: `06_raw_videos/2026-10-21_ai-wont-make-you-money/seg02.mp4`
- B-roll / edit ideas for this clip (added in editing, not generated): Text card '1' pops in. Stock clip of a dog groomer at work, phone buzzing on the counter. / Text card '2'. Split screen: 'AI automation' crossed out vs 'fewer missed bookings' highlighted.

### Clip 03 (8s)

```text
The person in the start image speaking directly to camera, vertical 9:16 medium close-up, chest up, eye-level, phone-camera realism, shallow depth of field. Setting: tidy modern home office, bookshelf and plant softly blurred behind. Wardrobe: plain dark crew-neck t-shirt or overshirt. Lighting: soft key light from the front-left, gentle rim light, natural skin tones. Performance: animated, counts on fingers or gestures as if showing something. Accurate lip-sync to the provided audio, natural blinking, subtle realistic head and shoulder movement, steady framing, no camera cuts. No on-screen text, no captions, no logos, no watermarks, no extra people, hands natural with five fingers.
```

- Audio reference: `voice_03.m4a`
- Save the result as: `06_raw_videos/2026-10-21_ai-wont-make-you-money/seg03.mp4`
- B-roll / edit ideas for this clip (added in editing, not generated): Mock-up of a simple one-line offer on a phone screen (made in Canva, no real business named).

### Clip 04 (10s)

```text
The person in the start image speaking directly to camera, vertical 9:16 medium close-up, chest up, eye-level, phone-camera realism, shallow depth of field. Setting: tidy modern home office, bookshelf and plant softly blurred behind. Wardrobe: plain dark crew-neck t-shirt or overshirt. Lighting: soft key light from the front-left, gentle rim light, natural skin tones. Performance: clear and confident, small explanatory hand gestures at chest height; warm, friendly smile, small nod, relaxed shoulders. Accurate lip-sync to the provided audio, natural blinking, subtle realistic head and shoulder movement, steady framing, no camera cuts. No on-screen text, no captions, no logos, no watermarks, no extra people, hands natural with five fingers.
```

- Audio reference: `voice_04.m4a`
- Save the result as: `06_raw_videos/2026-10-21_ai-wont-make-you-money/seg04.mp4`
- B-roll / edit ideas for this clip (added in editing, not generated): Text card '3'. Back to talking head, finger tap on the word 'early'. / Warm smile, small nod, point down to the follow button.

## Step 3 - Quality check each clip before moving on

- Lips match the words (watch with sound at full screen)
- Face looks like you; no warping around teeth, eyes or hands
- Voice is clear with no echo or clipping
- If a clip fails: regenerate once with the same settings; if it fails again, re-record the audio slower or use a clearer start photo.

## Step 4 - Assemble, caption and check (free, on your computer)

```bash
python3 factory.py assemble 2026-10-21_ai-wont-make-you-money
```

This joins `06_raw_videos/2026-10-21_ai-wont-make-you-money/seg01.mp4, seg02.mp4...`, burns in captions, and runs the quality check. Output: `07_edited_videos/2026-10-21_ai-wont-make-you-money_final.mp4`.

## Ask Claude Code to do Step 2 for you (optional)

If the Higgsfield connector is enabled in your Claude Code session, you can say:

> Generate the Higgsfield clips for `2026-10-21_ai-wont-make-you-money` using my start photo and the voice files I upload. Quote the credit cost and wait for my approval before generating.

Claude must show you the credit cost and get your OK before every paid generation.
