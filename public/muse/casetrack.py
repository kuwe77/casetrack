#!/usr/bin/env python3
"""CaseTrack Muse hook. Python standard library only; never invokes a model."""
import argparse
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

os.umask(0o077)
ROOT = Path(os.environ.get("CASETRACK_HOME", "~/.config/casetrack")).expanduser()
ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
JOB = ROOT / "job.json"
LAST = ROOT / "last-result.json"
VERSION = "2026-10-21.3"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def write_json(path, data):
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(data, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def proxy_details(proxies, hostname):
    # Identify the selected endpoint without exposing its address or credentials.
    details = {"https_proxy_configured": bool(proxies.get("https")),
               "all_proxy_configured": bool(proxies.get("all"))}
    try:
        bypass = urllib.request.proxy_bypass(hostname)
        details["proxy_mode"] = "bypass" if bypass else "https_proxy" if proxies.get("https") else "direct"
        if proxies.get("https") and not bypass:
            value = proxies["https"]
            parsed = urllib.parse.urlsplit(value if "://" in value else "//" + value)
            endpoint = "%s://%s:%s" % (parsed.scheme or "http", parsed.hostname or "", parsed.port or "default")
            details["proxy_endpoint_id"] = hashlib.sha256(endpoint.encode()).hexdigest()[:12]
    except (ValueError, OSError):
        details["proxy_mode"] = "unknown"
    return details


def failure_details(error):
    # Exception messages/reasons can contain proxy URLs, credentials or response bodies.
    cause = error.reason if isinstance(error, urllib.error.URLError) and isinstance(error.reason, BaseException) else error
    details = {"error_type": type(error).__name__, "cause_type": type(cause).__name__}
    # CPython's CONNECT rejection is OSError(text), with no errno or HTTPError.
    # Extract only its numeric status; the proxy's reason text remains private.
    if isinstance(cause, OSError) and cause.args and isinstance(cause.args[0], str):
        tunnel = re.match(r"\ATunnel connection failed: ([1-5][0-9]{2})(?:\s|$)", cause.args[0])
        if tunnel:
            details.update(phase="proxy_connect", proxy_http_status=int(tunnel.group(1)))
    number = getattr(cause, "errno", None)
    if isinstance(number, int):
        details["errno"] = number
        if number in errno.errorcode:
            details["errno_name"] = errno.errorcode[number]
    verify_code = getattr(cause, "verify_code", None)
    if isinstance(verify_code, int):
        details["tls_verify_code"] = verify_code
    return details


def response_details(response):
    details = {"http_status": response.code}
    ray = response.headers.get("CF-Ray", "")
    if re.fullmatch(r"[0-9a-fA-F]{16,32}(?:-[A-Za-z]{3})?", ray):
        details["cf_ray"] = ray
    return details


def user_agent(config):
    source = "environment" if "CASETRACK_USER_AGENT" in os.environ else "config" if "user_agent" in config else "default"
    value = os.environ.get("CASETRACK_USER_AGENT") if source == "environment" else config.get("user_agent", "CaseTrack-Muse/" + VERSION)
    if not isinstance(value, str) or not value.strip() or len(value) > 512 or any(ord(c) < 32 or ord(c) > 126 for c in value):
        raise RuntimeError("User-Agent must be 1–512 printable ASCII characters without line breaks.")
    return value, source


def api(route, method="GET", data=None, claim=None, diagnostics=False):
    config_path = ROOT / "config.json"
    if config_path.stat().st_mode & 0o077:
        raise RuntimeError("config.json must be private: chmod 600 ~/.config/casetrack/config.json")
    config = read_json(config_path)
    base = config["url"].rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise RuntimeError("Configure the HTTPS website origin only.")
    agent, agent_source = user_agent(config)
    headers = {"Authorization": "Bearer " + config["key"], "Accept": "application/json", "User-Agent": agent}
    if claim:
        headers["X-Job-Token"] = claim["token"]
    raw = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        raw = json.dumps(data).encode()
    request = urllib.request.Request(base + "/api/v1/whatsapp/assistant" + route, data=raw, headers=headers, method=method)
    started = time.monotonic()
    detail = {"helper_version": VERSION, "timestamp_utc": datetime.now(timezone.utc).isoformat(),
              "method": method, "route": re.sub(r"/jobs/[^/]+", "/jobs/:id", route.split("?")[0]),
              "phase": "proxy_config", "http_status": None, "user_agent_source": agent_source}
    def diagnostic(error=None):
        return json.dumps({**detail, "elapsed_ms": round((time.monotonic() - started) * 1000),
                           **(failure_details(error) if error else {})}, sort_keys=True)
    try:
        proxies = urllib.request.getproxies()
        detail.update(proxy_details(proxies, parsed.hostname))
        opener = urllib.request.build_opener(urllib.request.ProxyHandler(proxies), NoRedirect)
        detail["phase"] = "connect_or_headers"
        with opener.open(request, timeout=60) as response:
            detail.update(response_details(response))
            detail["headers_ms"] = round((time.monotonic() - started) * 1000)
            detail["phase"] = "read_body"
            body = response.read()
            detail["phase"] = "decode_json"
            result = json.loads(body)
            if not isinstance(result, dict):
                raise ValueError("Unexpected API response shape")
            detail["phase"] = "complete"
            if diagnostics:
                print("CaseTrack transport: " + diagnostic(), file=sys.stderr)
            return result
    except urllib.error.HTTPError as error:
        # Never log headers, credentials, question contents or raw provider responses.
        detail.update(response_details(error))
        detail["phase"] = "http_status"
        error.close()
        message = "CaseTrack request failed (HTTP %s)." % error.code
        if error.code == 409:
            message += " Check this job's status. Stop on held/skipped; refresh context and rewrite only for an active processing job with context_changed. Otherwise leave it for review."
        if error.code == 401:
            message += " Renew the restricted key in CaseTrack."
        raise RuntimeError(message + " Diagnostic: " + diagnostic(error)) from None
    except Exception as error:
        # http.client errors such as RemoteDisconnected/IncompleteRead are not all OSErrors.
        raise RuntimeError("CaseTrack connection or response failed; server outcome may be unknown. "
                           "No local job state was cleared. Diagnostic: " + diagnostic(error)) from None


def expires(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def claim_for(job_id, allow_completed=False):
    claim = read_json(JOB) if JOB.exists() else {}
    if claim.get("id") != job_id and allow_completed and LAST.exists():
        claim = read_json(LAST)
    if claim.get("id") != job_id:
        raise RuntimeError("That job is no longer the local active job. Do not use another job's context.")
    return claim


def poll(include_followups=False):
    # One fast check per hook, with no background process and no model SDK.
    with (ROOT / "poll.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return "silent"
        if JOB.exists() and expires(read_json(JOB)["lease_until"]) > time.time():
            return "silent"
        if api("/poll?followups=1" if include_followups else "/poll")["action"] != "wake":
            return "silent"
        result = api("/claim", "POST", {"include_followups": True} if include_followups else {})
        if not result.get("job"):
            return "silent"
        # Persist the claim before waking Muse. A lost response/file is recoverable after the server lease.
        write_json(JOB, result["job"])
        return "wake"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("poll").add_argument("--include-followups", action="store_true", help="Process enabled case-stage notifications as well as replies")
    commands.add_parser("diagnose", help="One read-only poll with safe transport details; never claims a job").add_argument("--include-followups", action="store_true")
    context = commands.add_parser("context")
    context.add_argument("--job")
    for name in ("heartbeat", "skip", "reply", "status"):
        command = commands.add_parser(name)
        command.add_argument("--job", required=True)
        if name == "reply":
            command.add_argument("--file", required=True, help="Private JSON file with body and context_version")
    args = parser.parse_args()
    if args.command == "diagnose":
        api("/poll?followups=1" if args.include_followups else "/poll", diagnostics=True)
        return
    if args.command == "poll":
        print(poll(args.include_followups))
        return
    claim = claim_for(args.job, args.command == "status") if args.job else read_json(JOB)
    route = "/jobs/" + urllib.parse.quote(claim["id"], safe="")
    if args.command == "context":
        result = api(route, claim=claim)
    elif args.command == "status":
        result = api(route + "/status", claim=claim)
    elif args.command == "heartbeat":
        result = api(route + "/heartbeat", "POST", {}, claim)
        claim["lease_until"] = result["lease_until"]
        write_json(JOB, claim)
    elif args.command == "skip":
        result = api(route + "/skip", "POST", {}, claim)
        JOB.unlink(missing_ok=True)
    else:
        draft = Path(args.file).expanduser()
        result = api(route + "/reply", "POST", read_json(draft), claim)
        # Keep the claim while sending is unresolved; status can reconcile it without another send.
        if result["state"] not in ("processing", "sending"):
            write_json(LAST, claim)
            JOB.unlink(missing_ok=True)
            draft.unlink(missing_ok=True)
    print(json.dumps(result, ensure_ascii=False))


def run():
    try:
        main()
        return 0
    except Exception as error:
        if len(sys.argv) > 1 and sys.argv[1] == "poll":
            print("silent")
        print(str(error) if isinstance(error, (RuntimeError, FileNotFoundError)) else "CaseTrack helper failed. Check the local job state before retrying.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(run())
