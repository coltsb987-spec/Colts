"""Tests for factory.py. Run with:  python3 -m unittest discover tests -v"""
import contextlib
import copy
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
import factory  # noqa: E402

SAMPLE = REPO / "03_scripts" / "2026-10-21_ai-wont-make-you-money.json"
if not SAMPLE.exists():
    SAMPLE = REPO / "04_approved_scripts" / "2026-10-21_ai-wont-make-you-money.json"


class TempProject(unittest.TestCase):
    """Runs every test against a throwaway copy of the project folders."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(REPO / "config", self.tmp / "config")
        shutil.copytree(REPO / "templates", self.tmp / "templates")
        for folder in factory.DIRS.values():
            (self.tmp / folder).mkdir(parents=True, exist_ok=True)
        (self.tmp / "01_research" / "reports").mkdir()
        (self.tmp / "10_analytics" / "reports").mkdir()
        self._old = factory.ROOT, factory.CONFIG
        factory.ROOT, factory.CONFIG = self.tmp, self.tmp / "config"
        self.script = json.loads(SAMPLE.read_text())

    def tearDown(self):
        factory.ROOT, factory.CONFIG = self._old
        shutil.rmtree(self.tmp)

    def run_cli(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = factory.main(list(argv))
        return code, out.getvalue()


class ScriptChecks(TempProject):
    def test_sample_script_passes(self):
        errors, _ = factory.check_script(self.script, factory.settings())
        self.assertEqual(errors, [])

    def test_all_five_samples_have_valid_structure(self):
        files = sorted((REPO / "03_scripts").glob("*.json")) + sorted((REPO / "04_approved_scripts").glob("*.json"))
        self.assertGreaterEqual(len(files), 5)
        for f in files:
            errors, _ = factory.check_script(json.loads(f.read_text()), factory.settings())
            structural = [e for e in errors if "verification" not in e]
            self.assertEqual(structural, [], f.name)

    def test_income_guarantee_blocks_approval(self):
        s = copy.deepcopy(self.script)
        s["beats"][2]["voiceover"] = "This is guaranteed to work for everyone."
        errors, _ = factory.check_script(s, factory.settings())
        self.assertTrue(any("guarantee" in e for e in errors))

    def test_negated_guarantee_is_only_a_warning(self):
        s = copy.deepcopy(self.script)
        s["instagram"]["caption"] += " A test won't guarantee success."
        errors, warns = factory.check_script(s, factory.settings())
        self.assertFalse(any("guarantee" in e for e in errors))
        self.assertTrue(any("negated" in w for w in warns))

    def test_invented_personal_results_blocked_unless_confirmed(self):
        s = copy.deepcopy(self.script)
        s["beats"][2]["voiceover"] = "Last month I made £3,000 a month with this."
        errors, _ = factory.check_script(s, factory.settings())
        self.assertTrue(any("Personal results" in e for e in errors))
        s["personal_claims_confirmed"] = True
        errors, _ = factory.check_script(s, factory.settings())
        self.assertFalse(any("Personal results" in e for e in errors))

    def test_unverified_claim_blocks_approval(self):
        s = copy.deepcopy(self.script)
        s["claims"].append({"claim": "Tool X is free", "source": "", "status": "needs_verification"})
        errors, _ = factory.check_script(s, factory.settings())
        self.assertTrue(any("needs verification" in e for e in errors))

    def test_too_long_script_rejected(self):
        s = copy.deepcopy(self.script)
        s["beats"][3]["voiceover"] = "word " * 120
        errors, _ = factory.check_script(s, factory.settings())
        self.assertTrue(any("estimated length" in e for e in errors))

    def test_affiliate_requires_ad_label_first(self):
        s = copy.deepcopy(self.script)
        s["disclosure"]["affiliate"] = True
        errors, _ = factory.check_script(s, factory.settings())
        self.assertTrue(any("must START" in e for e in errors))
        s["instagram"]["caption"] = "#ad " + s["instagram"]["caption"]
        s["youtube"]["description"] = "#ad " + s["youtube"]["description"]
        errors, _ = factory.check_script(s, factory.settings())
        self.assertFalse(any("affiliate" in e for e in errors))

    def test_hashtag_stuffing_rejected(self):
        s = copy.deepcopy(self.script)
        s["hashtags"] = [f"#tag{i}" for i in range(15)]
        errors, _ = factory.check_script(s, factory.settings())
        self.assertTrue(any("hashtags" in e for e in errors))


class Captions(TempProject):
    def test_srt_covers_whole_script_in_order(self):
        cues = factory.caption_cues(self.script, 2.6, 4)
        text = " ".join(c[2] for c in cues).split()
        self.assertEqual(text, factory.script_text(self.script).split())
        for (a, b, _), (c, _, _) in zip(cues, cues[1:]):
            self.assertLess(a, b)
            self.assertAlmostEqual(b, c)

    def test_srt_scales_to_real_audio_length(self):
        cues = factory.caption_cues(self.script, 2.6, 4, total_seconds=50.0)
        self.assertAlmostEqual(cues[-1][1], 50.0, places=3)

    def test_srt_time_format(self):
        self.assertEqual(factory.srt_time(3723.456), "01:02:03,456")

    def test_segments_fit_model_limit(self):
        segs = factory.segments(self.script, 2.6, 14)
        self.assertTrue(all(g["seconds"] <= 14 for g in segs))
        joined = " ".join(g["text"] for g in segs)
        self.assertEqual(joined, factory.script_text(self.script))


class Ideas(TempProject):
    def test_ten_complete_ideas(self):
        import datetime as dt
        ideas = factory.generate_ideas(dt.date(2026, 10, 21), 10, {})
        self.assertEqual(len(ideas), 10)
        fields = ["topic", "target_audience", "audience_problem", "suggested_hook",
                  "why_it_may_attract_attention", "evidence_status", "suggested_cta"]
        for i in ideas:
            for f in fields:
                self.assertTrue(i[f], f)
            self.assertIn("Hypothesis", i["evidence_status"])
        self.assertGreaterEqual(len({i["category"] for i in ideas}), 6)  # spread across categories

    def test_research_evidence_is_attached(self):
        rows = [dict(creator_username="example_a", category="business_mistakes", video_url=f"https://x/{n}",
                     views="1000", likes="50") for n in range(4)]
        insights = factory.analyze_research(rows)
        import datetime as dt
        ideas = factory.generate_ideas(dt.date(2026, 10, 21), 10, insights)
        mistakes = [i for i in ideas if i["category"] == "business_mistakes"]
        self.assertTrue(mistakes)
        self.assertIn("https://x/0", mistakes[0]["evidence_links"])
        self.assertIn("4 logged", mistakes[0]["evidence_status"])

    def test_cli_writes_files(self):
        code, _ = self.run_cli("ideas", "--date", "2026-10-21")
        self.assertEqual(code, 0)
        self.assertTrue((self.tmp / "02_ideas" / "ideas_2026-10-21.md").exists())
        code, _ = self.run_cli("new-script", "--idea", "1", "--date", "2026-10-21")
        self.assertEqual(code, 0)
        self.assertEqual(len(list((self.tmp / "03_scripts").glob("*.json"))), 1)


class Research(TempProject):
    def test_example_research_file_analyses(self):
        rows = factory.read_csv(REPO / "examples" / "example_research_log.csv")
        creators = factory.read_csv(REPO / "examples" / "example_creators.csv")
        self.assertEqual(factory.validate_research(rows, creators), [])
        insights = factory.analyze_research(rows)
        self.assertEqual(insights["total_videos"], len(rows))
        md = factory.research_report_md(insights)
        self.assertIn("hypothesis", md.lower())

    def test_bad_category_reported(self):
        problems = factory.validate_research([{"creator_username": "a", "category": "crypto"}], [])
        self.assertTrue(any("unknown category" in p for p in problems))

    def test_graph_api_payload_conversion(self):
        payload = {"business_discovery": {"username": "creator", "media": {"data": [
            {"media_type": "VIDEO", "media_product_type": "REELS", "permalink": "https://ig/reel/1",
             "like_count": 10, "comments_count": 2, "timestamp": "2026-10-01T10:00:00+0000"},
            {"media_type": "IMAGE", "media_product_type": "FEED", "permalink": "https://ig/p/2"}]}}}
        rows = factory.discovery_to_rows(payload)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["posted_date"], "2026-10-01")
        self.assertEqual(rows[0]["likes"], 10)

    def test_fetch_without_credentials_is_safe(self):
        import os
        for k in ("IG_USER_ID", "IG_ACCESS_TOKEN"):
            os.environ.pop(k, None)
        code, out = self.run_cli("research-fetch")
        self.assertEqual(code, 1)
        self.assertIn("not configured", out)


class Analytics(TempProject):
    def test_weekly_report_from_example(self):
        rows = factory.read_csv(REPO / "examples" / "example_content_tracker.csv")
        import datetime as dt
        md = factory.weekly_report(rows, dt.date(2026, 10, 25))
        self.assertIn("ranked by quality score", md)
        self.assertIn("Experiments for next week", md)
        self.assertIn("reach without retention", md)  # the high-view, low-quality example is flagged

    def test_views_alone_do_not_win(self):
        rows = [
            dict(topic="viral", views="100000", video_length_sec="30", avg_watch_time_sec="6", shares="10",
                 saves="10", followers_gained="5", comments="20"),
            dict(topic="quality", views="5000", video_length_sec="30", avg_watch_time_sec="21", shares="60",
                 saves="80", followers_gained="40", comments="30"),
            dict(topic="mid", views="20000", video_length_sec="30", avg_watch_time_sec="12", shares="40",
                 saves="40", followers_gained="20", comments="25"),
        ]
        scored = sorted(factory.score_rows(rows), key=lambda r: r["_score"], reverse=True)
        self.assertEqual(scored[0]["topic"], "quality")

    def test_empty_tracker(self):
        import datetime as dt
        md = factory.weekly_report([], dt.date(2026, 10, 25))
        self.assertIn("No numbers yet", md)


class Packaging(TempProject):
    def test_approve_builds_full_package(self):
        src = self.tmp / "03_scripts" / SAMPLE.name
        src.write_text(SAMPLE.read_text())
        code, out = self.run_cli("approve", self.script["id"], "--by", "tester")
        self.assertEqual(code, 0, out)
        sid = self.script["id"]
        self.assertFalse(src.exists())
        approved = json.loads((self.tmp / "04_approved_scripts" / f"{sid}.json").read_text())
        self.assertEqual(approved["status"], "approved")
        for f in ("captions.srt", "instagram_post.txt", "youtube_post.txt", "thumbnail_brief.md"):
            self.assertTrue((self.tmp / "08_captions_thumbnails" / sid / f).exists(), f)
        hf = (self.tmp / "05_higgsfield_prompts" / f"{sid}_higgsfield.md").read_text()
        self.assertIn("9:16", hf)
        self.assertIn("voice_01.m4a", hf)
        ig = (self.tmp / "08_captions_thumbnails" / sid / "instagram_post.txt").read_text()
        self.assertIn("#aibusiness", ig)
        self.assertIn("AI label", ig)

    def test_calendar_and_publish_log(self):
        (self.tmp / "04_approved_scripts" / SAMPLE.name).write_text(SAMPLE.read_text())
        code, _ = self.run_cli("calendar", "--days", "7", "--start", "2026-10-26")
        self.assertEqual(code, 0)
        cal = factory.read_csv(self.tmp / "00_planning" / "content_calendar.csv")
        self.assertEqual(len(cal), 6)  # Mon/Wed/Fri x 2 platforms
        self.assertEqual(cal[0]["script_id"], self.script["id"])
        code, _ = self.run_cli("published", self.script["id"], "--platform", "instagram", "--date", "2026-10-26")
        self.assertEqual(code, 0)
        tracker = factory.read_csv(self.tmp / "10_analytics" / "content_tracker.csv")
        self.assertEqual(tracker[0]["script_id"], self.script["id"])


@unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg not installed")
class Video(TempProject):
    def make_clip(self, path, seconds, size="720x1280", freq=440):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                        f"testsrc2=size={size}:rate=30:duration={seconds}", "-f", "lavfi", "-i",
                        f"sine=frequency={freq}:duration={seconds}", "-shortest", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", "-c:a", "aac", str(path)], check=True)

    def test_assemble_burns_captions_and_passes_qc(self):
        sid = self.script["id"]
        (self.tmp / "04_approved_scripts" / f"{sid}.json").write_text(SAMPLE.read_text())
        raw = self.tmp / "06_raw_videos" / sid
        raw.mkdir(parents=True)
        self.make_clip(raw / "seg01.mp4", 10)
        self.make_clip(raw / "seg02.mp4", 13, size="1080x1920", freq=550)
        self.make_clip(raw / "seg03.mp4", 8, size="1280x720", freq=660)  # wrong shape gets padded
        self.make_clip(raw / "seg04.mp4", 9)
        code, out = self.run_cli("assemble", sid)
        self.assertEqual(code, 0, out)
        final = self.tmp / "07_edited_videos" / f"{sid}_final.mp4"
        errors, _, facts = factory.quality_check(final, factory.settings())
        self.assertEqual(errors, [])
        self.assertEqual((facts["width"], facts["height"]), (1080, 1920))
        self.assertAlmostEqual(facts["duration_sec"], 40, delta=0.5)
        srt = (self.tmp / "08_captions_thumbnails" / sid / "captions.srt").read_text()
        self.assertIn("00:00:39", srt)  # captions stretched to the real 40s length

    def test_qc_flags_landscape_video(self):
        clip = self.tmp / "landscape.mp4"
        self.make_clip(clip, 3, size="1280x720")
        errors, _, _ = factory.quality_check(clip, factory.settings())
        self.assertTrue(any("9:16" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
