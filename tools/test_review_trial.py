import argparse
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest

import review_trial as trial


class PreparationTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.base = Path(self.directory.name)
        source = self.base / "source"
        source.mkdir()
        trial.invoke(["git", "init", "--quiet", source])
        (source / "file.txt").write_text("original\n")
        trial.invoke(["git", "add", "file.txt"], source)
        trial.invoke(
            [
                "git",
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "base",
            ],
            source,
        )
        brief = self.base / "brief.md"
        protocol = self.base / "protocol.md"
        brief.write_text("The same task.\n")
        protocol.write_text("The same assessment.\n")
        self.root = self.base / "trial"
        self.args = argparse.Namespace(
            root=self.root,
            source=source,
            revision="HEAD",
            brief=brief,
            protocol=protocol,
            voyager=Path("/bin/true"),
            codex=Path("/bin/true"),
        )
        with contextlib.redirect_stdout(io.StringIO()):
            trial.prepare(self.args)

    def test_isolated_arms_and_identical_inputs(self):
        manifest = trial.load(self.root)
        self.assertEqual(len(manifest["arms"]), 2)
        for arm in manifest["arms"].values():
            self.assertEqual(len(arm["paths"]), 5)
            self.assertFalse(Path(arm["state_dir"]).exists())
        first = Path(manifest["arms"]["A"]["paths"]["snapshot"])
        second = Path(manifest["arms"]["B"]["paths"]["snapshot"])
        (first / "file.txt").write_text("changed by A\n")
        self.assertEqual((second / "file.txt").read_text(), "original\n")

    def test_detects_a_changed_brief(self):
        manifest = trial.load(self.root)
        path = Path(manifest["arms"]["A"]["paths"]["renderer"]) / ".trial/BRIEF.md"
        path.write_text("A different task.\n")
        with self.assertRaisesRegex(RuntimeError, "Brief differs"):
            trial.check(self.root)

    def test_detects_dirty_start(self):
        manifest = trial.load(self.root)
        path = Path(manifest["arms"]["A"]["paths"]["snapshot"]) / "file.txt"
        path.write_text("different start\n")
        with self.assertRaisesRegex(RuntimeError, "dirty"):
            trial.check(self.root)

    def test_refuses_to_overwrite_existing_trial(self):
        before = (self.root / "manifest.json").read_bytes()
        with self.assertRaisesRegex(RuntimeError, "already exists"):
            trial.prepare(self.args)
        self.assertEqual((self.root / "manifest.json").read_bytes(), before)

    def test_no_run_before_rehearsal(self):
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "rehearsal"):
                trial.run(self.root, "A")
        self.assertEqual(
            json.loads((self.root / "manifest.json").read_text())["arms"]["A"]["phase"],
            "prepared",
        )


if __name__ == "__main__":
    unittest.main()
