"""Local Wrangler -> real Container -> disposable MongoDB acceptance.

Run after frontend build, from backend: .venv/Scripts/python.exe tests/worker_smoke.py
No Cloudflare deployment, account provisioning, .env reads, or Atlas connections.
"""

import json
import os
import secrets
import signal
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from uuid import uuid4

from argon2 import PasswordHasher
from pymongo import MongoClient
from worker_runtime import check_sidecars, cleanup_runtime, runtime_snapshot

if os.name == "nt":
    raise SystemExit(
        "Wrangler container dev requires Linux/WSL; run this check in WSL, not Windows."
    )

root = Path(__file__).resolve().parents[1]
frontend = root.parent / "frontend"
project = "kanban-worker-test-" + uuid4().hex[:12]
test_dir = frontend / ".wrangler" / project
test_dir.mkdir(parents=True)
compose = ["docker", "compose", "-p", project, "-f", str(root / "compose.test.yml")]
origin = "http://127.0.0.1:8787"
process = None
mongo = None
log = None


def run(args, **kwargs):
    return subprocess.run(args, check=True, cwd=root, **kwargs)


def call(path, method="GET", body=None, cookie=None, source=origin):
    headers = {}
    if source is not None:
        headers["Origin"] = source
    if cookie:
        headers["Cookie"] = cookie
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        origin + path,
        method=method,
        headers=headers,
        data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        response = urllib.request.urlopen(request, timeout=25)
    except urllib.error.HTTPError as exc:
        response = exc
    raw = response.read()
    return response.status, response.headers, raw


try:
    # Fail before starting anything if another service owns the selected local Worker port.
    import socket

    with socket.socket() as check_port:
        check_port.bind(("127.0.0.1", 8787))
    run([*compose, "up", "-d", "--wait", "--wait-timeout", "120", "mongo"])
    address = run(
        [*compose, "port", "mongo", "27017"], capture_output=True, text=True
    ).stdout.strip()
    port = address.rsplit(":", 1)[1]
    mongo = MongoClient(f"mongodb://127.0.0.1:{port}/?replicaSet=rs0&directConnection=true")
    database = "kanban_test_" + uuid4().hex[:24]
    db = mongo[database]
    password = secrets.token_urlsafe(24)
    db.users.insert_one({"_id": "fixture-user", "password_hash": PasswordHasher().hash(password)})
    config = json.loads((frontend / "wrangler.jsonc").read_text())
    config.update(
        {
            "name": project,
            "main": str(frontend / "worker/index.ts"),
            "routes": [],
            "vars": {"DEPLOYMENT_ENV": "local", "PUBLIC_ORIGIN": origin, "MONGO_DB": database},
        }
    )
    config.pop("$schema", None)
    config["assets"]["directory"] = str(frontend / "dist")
    config["containers"][0]["image"] = str(root / "Dockerfile")
    config["containers"][0]["image_build_context"] = str(root)
    config_path = test_dir / "wrangler.json"
    config_path.write_text(json.dumps(config))
    (test_dir / ".dev.vars").write_text(
        f"MONGO_URL=mongodb://host.docker.internal:{port}/?replicaSet=rs0&directConnection=true\n"
        f"JWT_SECRET={secrets.token_urlsafe(48)}\nPROXY_SECRET={secrets.token_urlsafe(48)}\n"
    )
    log = (test_dir / "runtime.log").open("w")
    process = subprocess.Popen(
        [
            "node",
            os.environ.get("WRANGLER_CLI", str(frontend / "node_modules/wrangler/bin/wrangler.js")),
            "dev",
            "--config",
            str(config_path),
            "--ip",
            "127.0.0.1",
            "--port",
            "8787",
            "--log-level",
            "error",
        ],
        cwd=frontend,
        stdout=log,
        stderr=subprocess.STDOUT,
        env={**os.environ, "CI": "true", "WRANGLER_SEND_METRICS": "false"},
        start_new_session=True,
    )
    startup_deadline = time.monotonic() + 180
    while time.monotonic() < startup_deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Wrangler exited; inspect {test_dir / 'runtime.log'}")
        check_sidecars(project)
        try:
            if call("/api/health/ready")[0] == 200:
                break
        except (OSError, TimeoutError):
            pass
        time.sleep(1)
    else:
        raise RuntimeError(f"Worker did not become ready; inspect {test_dir / 'runtime.log'}")
    assert call("/")[0] == 200
    assert call("/login")[0] == 200
    assert call("/api/not-found")[0] == 404
    denied = call("/api/auth/login", "POST", {}, source=None)
    assert denied[0] == 403 and json.loads(denied[2])["error"]["code"] == "csrf_rejected"
    assert db.login_limits.count_documents({}) == 0
    status, headers, body = call(
        "/api/auth/login", "POST", {"username": " FIXTURE-USER ", "password": password}
    )
    assert status == 200, f"Login status {status}"
    assert json.loads(body) == {"username": "fixture-user"}
    assert "HttpOnly" in headers["Set-Cookie"] and headers["Cache-Control"] == "no-store"
    cookie = headers["Set-Cookie"].split(";", 1)[0]
    assert call("/api/auth/me", cookie=cookie, source=None)[0] == 200
    status, _, body = call("/api/cards", "POST", {"title": "Worker fixture", "tag": "test"}, cookie)
    assert status == 201
    card = json.loads(body)
    path = f"/api/cards/{card['id']}"
    denied = call(path, "PATCH", {"title": "forbidden", "expected_version": 1}, cookie, "null")
    assert denied[0] == 403
    assert call(path, "PATCH", {"title": "updated", "expected_version": 1}, cookie)[0] == 200
    assert call(path, "PATCH", {"title": "stale", "expected_version": 1}, cookie)[0] == 409
    assert call(path + "/comments", "POST", {"text": "Worker comment"}, cookie)[0] == 201
    board = json.loads(call("/api/cards", cookie=cookie)[2])
    assert (
        call(
            path + "/move",
            "POST",
            {
                "column": "done",
                "expected_version": 2,
                "expected_order_versions": board["order_versions"],
            },
            cookie,
        )[0]
        == 200
    )
    for _ in range(4):
        assert (
            call("/api/auth/login", "POST", {"username": "fixture-user", "password": "wrong"})[0]
            == 401
        )
    denied = call("/api/auth/login", "POST", {"username": "fixture-user", "password": password})
    assert denied[0] == 429 and int(denied[1]["Retry-After"]) > 0
    assert call("/api/auth/logout", "POST", cookie=cookie, source="null")[0] == 403
    assert call("/api/auth/me", cookie=cookie)[0] == 200
    assert (
        call(path + "?expected_version=3&expected_comments_version=1", "DELETE", cookie=cookie)[0]
        == 204
    )
    assert call("/api/auth/logout", "POST", cookie=cookie)[0] == 204
    assert call("/api/auth/me", cookie=cookie)[0] == 401
    print(
        "PASS: real local Worker/assets/container/MongoDB auth, CSRF, throttling, CRUD and logout"
    )
finally:
    try:
        (test_dir / "runtime-state.json").write_text(
            json.dumps(runtime_snapshot(project), indent=2)
        )
    finally:
        try:
            if process is not None and process.poll() is None:
                # Stop only our process group before removing any leftover test sidecar.
                os.killpg(process.pid, signal.SIGINT)
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
        finally:
            if log is not None:
                log.close()
            if mongo is not None:
                mongo.close()
            (test_dir / ".dev.vars").unlink(missing_ok=True)
            try:
                cleanup_runtime(project)
            finally:
                run([*compose, "down", "--volumes", "--remove-orphans"])
