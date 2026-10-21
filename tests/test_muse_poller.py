"""Run on Linux: python3 tests/test_muse_poller.py. No network or model calls."""
import contextlib
import errno
import http.server
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import socket
import ssl
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch


class PollerTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.environment = patch.dict(os.environ, {"CASETRACK_HOME": self.directory.name})
        self.environment.start()
        os.environ.pop("CASETRACK_USER_AGENT", None)
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

    def transport(self, response=None, error=None):
        self.module.write_json(self.module.ROOT / "config.json", {"url": "https://example.test", "key": "PRIVATE-API-KEY"})
        opener = MagicMock()
        if error:
            opener.open.side_effect = error
        else:
            opener.open.return_value = response
        patched = patch.object(self.module.urllib.request, "build_opener", return_value=opener)
        patched.start()
        self.addCleanup(patched.stop)
        return opener

    def response(self, body=b'{}', ray="a4dc54eaf852c5e9-IAD"):
        response = io.BytesIO(body)
        response.code = 200
        response.headers = {"CF-Ray": ray, "Set-Cookie": "PRIVATE-COOKIE"}
        return response

    def test_network_errors_reveal_type_and_errno_without_secrets_or_job_id(self):
        for reason in [TimeoutError("PRIVATE-PROXY"), ConnectionResetError(errno.ECONNRESET, "PRIVATE-PROXY"),
                       socket.gaierror(socket.EAI_AGAIN, "PRIVATE-PROXY"), ssl.SSLError("PRIVATE-PROXY")]:
            with self.subTest(type=type(reason).__name__):
                opener = self.transport(error=self.module.urllib.error.URLError(reason))
                with patch.object(self.module.urllib.request, "getproxies", return_value={"https": "http://PRIVATE-USER:PRIVATE-PASSWORD@proxy.test:8080"}), \
                     patch.object(self.module.urllib.request, "proxy_bypass", return_value=False), \
                     self.assertRaises(RuntimeError) as caught:
                    self.module.api("/jobs/PRIVATE-JOB", claim=self.claim)
                message = str(caught.exception)
                details = json.loads(message.split("Diagnostic: ")[1])
                self.assertEqual(details["phase"], "connect_or_headers")
                self.assertEqual(details["cause_type"], type(reason).__name__)
                self.assertEqual(details["route"], "/jobs/:id")
                self.assertEqual(details["proxy_mode"], "https_proxy")
                self.assertEqual(len(details["proxy_endpoint_id"]), 12)
                self.assertIsNone(details["http_status"])
                if reason.errno is not None:
                    self.assertEqual(details["errno"], reason.errno)
                self.assertNotIn("PRIVATE", message)
                self.assertNotIn("proxy.test", message)
                self.assertNotIn(self.claim["token"], message)
                self.assertEqual(opener.open.call_count, 1)

    def test_http_failure_retains_safe_ray_and_status_not_headers_or_body(self):
        error = self.module.urllib.error.HTTPError("https://example.test/PRIVATE-JOB", 503, "PRIVATE-REASON",
                    {"CF-Ray": "a4dc54eaf852c5e9-IAD", "Set-Cookie": "PRIVATE-COOKIE"}, io.BytesIO(b'PRIVATE-BODY'))
        self.transport(error=error)
        with self.assertRaises(RuntimeError) as caught:
            self.module.api("/jobs/PRIVATE-JOB/reply", "POST", {"body": "PRIVATE-DRAFT"}, self.claim)
        message = str(caught.exception)
        details = json.loads(message.split("Diagnostic: ")[1])
        self.assertEqual(details["http_status"], 503)
        self.assertEqual(details["cf_ray"], "a4dc54eaf852c5e9-IAD")
        self.assertEqual(details["route"], "/jobs/:id/reply")
        self.assertEqual(details["phase"], "http_status")
        self.assertNotIn("PRIVATE", message)

    def test_invalid_json_is_distinguished_from_no_response_without_echoing_body(self):
        self.transport(response=self.response(b'<html>PRIVATE-PROXY-RESPONSE</html>', ray="PRIVATE-NOT-A-RAY"))
        with self.assertRaises(RuntimeError) as caught:
            self.module.api("/poll")
        details = json.loads(str(caught.exception).split("Diagnostic: ")[1])
        self.assertEqual(details["phase"], "decode_json")
        self.assertEqual(details["http_status"], 200)
        self.assertEqual(details["cause_type"], "JSONDecodeError")
        self.assertNotIn("cf_ray", details)
        self.assertNotIn("PRIVATE", str(caught.exception))

    def test_body_read_error_retains_response_metadata(self):
        response = MagicMock(code=200, headers={"CF-Ray": "a4dc54eaf852c5e9-IAD"})
        response.__enter__.return_value = response
        response.read.side_effect = TimeoutError("PRIVATE-BODY")
        self.transport(response=response)
        with self.assertRaises(RuntimeError) as caught:
            self.module.api("/poll")
        details = json.loads(str(caught.exception).split("Diagnostic: ")[1])
        self.assertEqual(details["phase"], "read_body")
        self.assertEqual(details["http_status"], 200)
        self.assertEqual(details["cf_ray"], "a4dc54eaf852c5e9-IAD")
        self.assertNotIn("PRIVATE", str(caught.exception))

    def test_diagnose_never_claims_or_wakes_even_with_available_work(self):
        opener = self.transport(response=self.response(b'{"action":"wake","poll_after_seconds":30}'))
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(sys, "argv", ["casetrack.py", "diagnose"]), \
             contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            self.assertEqual(self.module.run(), 0)
        self.assertEqual(output.getvalue(), "")
        self.assertFalse(self.module.JOB.exists())
        self.assertEqual(opener.open.call_count, 1)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.method, "GET")
        self.assertTrue(request.full_url.endswith("/assistant/poll"))
        details = json.loads(errors.getvalue().split("CaseTrack transport: ")[1])
        self.assertEqual(details["phase"], "complete")
        self.assertEqual(details["http_status"], 200)
        self.assertNotIn("PRIVATE", errors.getvalue())

    def test_lost_claim_response_exits_silent_without_retry_or_local_ack(self):
        opener = self.transport()
        opener.open.side_effect = [self.response(b'{"action":"wake"}'), TimeoutError("PRIVATE-PROXY")]
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(sys, "argv", ["casetrack.py", "poll"]), \
             contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            self.assertEqual(self.module.run(), 1)
        self.assertEqual(output.getvalue(), "silent\n")
        self.assertEqual(opener.open.call_count, 2)
        self.assertFalse(self.module.JOB.exists())
        self.assertIn("server outcome may be unknown", errors.getvalue())
        self.assertNotIn("PRIVATE", errors.getvalue())

    def test_reply_transport_failure_keeps_exact_claim_and_draft(self):
        self.module.write_json(self.module.JOB, self.claim)
        draft = Path(self.directory.name) / "draft.json"
        data = {"body": "PRIVATE-DRAFT", "context_version": "b" * 64}
        self.module.write_json(draft, data)
        opener = self.transport(error=ConnectionResetError(errno.ECONNRESET, "PRIVATE-PROXY"))
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(sys, "argv", ["casetrack.py", "reply", "--job", self.claim["id"], "--file", str(draft)]), \
             contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            self.assertEqual(self.module.run(), 1)
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(self.module.read_json(self.module.JOB), self.claim)
        self.assertEqual(self.module.read_json(draft), data)
        self.assertEqual(opener.open.call_count, 1)
        self.assertNotIn("PRIVATE", errors.getvalue())

    def test_proxy_diagnostics_distinguish_all_proxy_only_and_bypass(self):
        with patch.object(self.module.urllib.request, "proxy_bypass", return_value=False):
            details = self.module.proxy_details({"all": "http://PRIVATE-PROXY"}, "example.test")
        self.assertEqual(details, {"https_proxy_configured": False, "all_proxy_configured": True, "proxy_mode": "direct"})
        with patch.object(self.module.urllib.request, "proxy_bypass", return_value=True):
            details = self.module.proxy_details({"https": "http://PRIVATE-PROXY"}, "example.test")
        self.assertEqual(details["proxy_mode"], "bypass")
        self.assertNotIn("proxy_endpoint_id", details)

    def test_real_connect_rejections_report_proxy_status_without_origin_status(self):
        # Local proxy socket only: it refuses CONNECT and never contacts an origin.
        self.module.write_json(self.module.ROOT / "config.json", {"url": "https://example.test", "key": "PRIVATE-API-KEY"})
        for status in (403, 407, 502):
            with self.subTest(status=status):
                received = []
                class RejectProxy(http.server.BaseHTTPRequestHandler):
                    def do_CONNECT(handler):
                        received.append(handler.command)
                        handler.send_response(status, "PRIVATE-PROXY-REASON")
                        handler.send_header("CF-Ray", "a4dc54eaf852c5e9-IAD")
                        handler.end_headers()
                    def log_message(handler, *args):
                        pass
                with http.server.HTTPServer(("127.0.0.1", 0), RejectProxy) as server:
                    server.timeout = 3
                    thread = threading.Thread(target=server.handle_request, daemon=True)
                    thread.start()
                    try:
                        with patch.object(self.module.urllib.request, "getproxies", return_value={"https": "http://127.0.0.1:%d" % server.server_port}), \
                             patch.object(self.module.urllib.request, "proxy_bypass", return_value=False), \
                             self.assertRaises(RuntimeError) as caught:
                            self.module.api("/poll")
                    finally:
                        thread.join(timeout=4)
                self.assertFalse(thread.is_alive())
                self.assertEqual(received, ["CONNECT"])
                message = str(caught.exception)
                details = json.loads(message.split("Diagnostic: ")[1])
                self.assertEqual(details["error_type"], "URLError")
                self.assertEqual(details["cause_type"], "OSError")
                self.assertEqual(details["phase"], "proxy_connect")
                self.assertEqual(details["proxy_http_status"], status)
                self.assertIsNone(details["http_status"])
                self.assertNotIn("errno", details)
                self.assertNotIn("cf_ray", details)
                self.assertNotIn("PRIVATE", message)

    def test_unrecognized_oserror_text_remains_private_and_unclassified(self):
        error = self.module.urllib.error.URLError(OSError("PRIVATE failure with code 407"))
        details = self.module.failure_details(error)
        self.assertEqual(details, {"error_type": "URLError", "cause_type": "OSError"})

    def test_user_agent_default_config_and_environment_are_sent_not_logged(self):
        for source in ("default", "config", "environment"):
            with self.subTest(source=source):
                opener = self.transport(response=self.response())
                config = self.module.read_json(self.module.ROOT / "config.json")
                if source != "default":
                    config["user_agent"] = "PRIVATE-CONFIG-AGENT"
                    self.module.write_json(self.module.ROOT / "config.json", config)
                environment = {"CASETRACK_USER_AGENT": "PRIVATE-ENV-AGENT"} if source == "environment" else {}
                errors = io.StringIO()
                with patch.dict(os.environ, environment), contextlib.redirect_stderr(errors):
                    self.module.api("/poll", diagnostics=True)
                expected = {"default": "CaseTrack-Muse/" + self.module.VERSION, "config": "PRIVATE-CONFIG-AGENT", "environment": "PRIVATE-ENV-AGENT"}[source]
                self.assertEqual(opener.open.call_args.args[0].get_header("User-agent"), expected)
                details = json.loads(errors.getvalue().split("CaseTrack transport: ")[1])
                self.assertEqual(details["user_agent_source"], source)
                self.assertNotIn("PRIVATE", errors.getvalue())

    def test_invalid_user_agents_fail_before_network_without_echoing_value(self):
        for agent in ("PRIVATE\r\nAuthorization: injected", "PRIVATE\x00", "PRIVATE\u00e9", "", "x" * 513, 12):
            with self.subTest(agent_type=type(agent).__name__):
                opener = self.transport()
                config = self.module.read_json(self.module.ROOT / "config.json")
                config["user_agent"] = agent
                self.module.write_json(self.module.ROOT / "config.json", config)
                with self.assertRaises(RuntimeError) as caught:
                    self.module.api("/poll")
                self.assertNotIn("PRIVATE", str(caught.exception))
                opener.open.assert_not_called()


if __name__ == "__main__":
    unittest.main()
