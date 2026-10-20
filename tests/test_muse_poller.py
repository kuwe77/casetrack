"""Run on Linux: python3 tests/test_muse_poller.py. No network or model calls."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch


class PollerTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.environment = patch.dict(os.environ, {"CASETRACK_HOME": self.directory.name})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        spec = importlib.util.spec_from_file_location("casetrack_helper", Path(__file__).resolve().parents[1] / "public/muse/casetrack.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.claim = {"id": "job-a", "token": "a" * 64, "lease_until": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()}

    def test_empty_poll_does_not_claim_or_write_a_job(self):
        with patch.object(self.module, "api", return_value={"action": "silent"}) as api:
            self.assertEqual(self.module.poll(), "silent")
            api.assert_called_once_with("/poll")
            self.assertFalse(self.module.JOB.exists())

    def test_claim_persisted_before_one_wake_then_silent_without_network(self):
        with patch.object(self.module, "api", side_effect=[{"action": "wake"}, {"job": self.claim}]) as api:
            self.assertEqual(self.module.poll(), "wake")
            self.assertEqual(json.loads(self.module.JOB.read_text()), self.claim)
            self.assertEqual(self.module.JOB.stat().st_mode & 0o077, 0)
            self.assertEqual(self.module.poll(), "silent")
            self.assertEqual(api.call_count, 2)

    def test_expired_claim_recovers_but_a_losing_claim_does_not_wake(self):
        old = dict(self.claim, lease_until="2000-01-01T00:00:00+00:00")
        self.module.write_json(self.module.JOB, old)
        with patch.object(self.module, "api", side_effect=[{"action": "wake"}, {"job": None}]):
            self.assertEqual(self.module.poll(), "silent")
        with patch.object(self.module, "api", side_effect=[{"action": "wake"}, {"job": self.claim}]):
            self.assertEqual(self.module.poll(), "wake")
        with self.assertRaises(RuntimeError):
            self.module.claim_for("another-job")

    def test_completed_reply_keeps_status_token_but_removes_question_draft(self):
        self.module.write_json(self.module.JOB, self.claim)
        draft = Path(self.directory.name) / "draft.json"
        self.module.write_json(draft, {"body": "Synthetic", "context_version": "b" * 64})
        with patch.object(sys, "argv", ["casetrack.py", "reply", "--job", self.claim["id"], "--file", str(draft)]), \
             patch.object(self.module, "api", return_value={"state": "replied", "message": {"status": "accepted"}}), \
             contextlib.redirect_stdout(io.StringIO()):
            self.module.main()
        self.assertFalse(draft.exists())
        self.assertFalse(self.module.JOB.exists())
        self.assertEqual(self.module.claim_for("job-a", True), self.claim)

    def test_ambiguous_http_response_preserves_exact_draft_and_claim_for_retry(self):
        self.module.write_json(self.module.JOB, self.claim)
        draft = Path(self.directory.name) / "draft.json"
        self.module.write_json(draft, {"body": "Synthetic", "context_version": "b" * 64})
        with patch.object(sys, "argv", ["casetrack.py", "reply", "--job", self.claim["id"], "--file", str(draft)]), \
             patch.object(self.module, "api", side_effect=RuntimeError("Connection lost")), \
             self.assertRaises(RuntimeError):
            self.module.main()
        self.assertTrue(draft.exists())
        self.assertTrue(self.module.JOB.exists())

    def test_credentials_cannot_be_redirected_or_sent_over_plain_http(self):
        config = self.module.ROOT / "config.json"
        self.module.write_json(config, {"url": "http://example.test", "key": "synthetic"})
        with self.assertRaises(RuntimeError):
            self.module.api("/poll")
        self.module.write_json(config, {"url": "https://example.test", "key": "synthetic"})
        config.chmod(0o644)
        with self.assertRaises(RuntimeError):
            self.module.api("/poll")
        self.assertIsNone(self.module.NoRedirect().redirect_request(None, None, None, None, None, None))


if __name__ == "__main__":
    unittest.main()
