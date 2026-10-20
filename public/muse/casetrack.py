#!/usr/bin/env python3
"""CaseTrack Muse hook. Python standard library only; never invokes a model."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

os.umask(0o077)
ROOT = Path(os.environ.get("CASETRACK_HOME", "~/.config/casetrack")).expanduser()
ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
JOB = ROOT / "job.json"
LAST = ROOT / "last-result.json"


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


def api(route, method="GET", data=None, claim=None):
    config_path = ROOT / "config.json"
    if config_path.stat().st_mode & 0o077:
        raise RuntimeError("config.json must be private: chmod 600 ~/.config/casetrack/config.json")
    config = read_json(config_path)
    base = config["url"].rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise RuntimeError("Configure the HTTPS website origin only.")
    headers = {"Authorization": "Bearer " + config["key"], "Accept": "application/json"}
    if claim:
        headers["X-Job-Token"] = claim["token"]
    raw = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        raw = json.dumps(data).encode()
    request = urllib.request.Request(base + "/api/v1/whatsapp/assistant" + route, data=raw, headers=headers, method=method)
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Never log headers, credentials, question contents or raw provider responses.
        message = "CaseTrack request failed (HTTP %s)." % error.code
        if error.code == 409:
            message += " Refresh this job's context and rewrite if context_changed; otherwise leave it for review."
        if error.code == 401:
            message += " Renew the restricted key in CaseTrack."
        raise RuntimeError(message) from None


def expires(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def claim_for(job_id, allow_completed=False):
    claim = read_json(JOB) if JOB.exists() else {}
    if claim.get("id") != job_id and allow_completed and LAST.exists():
        claim = read_json(LAST)
    if claim.get("id") != job_id:
        raise RuntimeError("That job is no longer the local active job. Do not use another job's context.")
    return claim


def poll():
    # One fast check per hook, with no background process and no model SDK.
    with (ROOT / "poll.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return "silent"
        if JOB.exists() and expires(read_json(JOB)["lease_until"]) > time.time():
            return "silent"
        if api("/poll")["action"] != "wake":
            return "silent"
        result = api("/claim", "POST", {})
        if not result.get("job"):
            return "silent"
        # Persist the claim before waking Muse. A lost response/file is recoverable after the server lease.
        write_json(JOB, result["job"])
        return "wake"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("poll")
    context = commands.add_parser("context")
    context.add_argument("--job")
    for name in ("heartbeat", "skip", "reply", "status"):
        command = commands.add_parser(name)
        command.add_argument("--job", required=True)
        if name == "reply":
            command.add_argument("--file", required=True, help="Private JSON file with body and context_version")
    args = parser.parse_args()
    if args.command == "poll":
        print(poll())
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


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        if len(sys.argv) > 1 and sys.argv[1] == "poll":
            print("silent")
        print(str(error) if isinstance(error, (RuntimeError, FileNotFoundError)) else "CaseTrack connection failed; no job was acknowledged.", file=sys.stderr)
        sys.exit(1)
