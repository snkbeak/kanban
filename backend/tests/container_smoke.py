"""Run from backend: .venv/Scripts/python.exe tests/container_smoke.py

Creates/removes only a uniquely named Docker Compose test project and its volumes.
Never reads .env or connects to application/Atlas databases.
"""

import subprocess
import time
from pathlib import Path
from uuid import uuid4

root = Path(__file__).resolve().parents[1]
project = "kanban-container-test-" + uuid4().hex[:12]
compose = ["docker", "compose", "-p", project, "-f", str(root / "compose.test.yml")]


def run(args, **kwargs):
    return subprocess.run(args, check=True, cwd=root, **kwargs)


def wait_ready():
    for _ in range(40):
        result = subprocess.run(
            [
                *compose,
                "exec",
                "-T",
                "api",
                "python",
                "-c",
                "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health/live')",
            ],
            capture_output=True,
            cwd=root,
        )
        if result.returncode == 0:
            return
        time.sleep(1)
    raise RuntimeError("Disposable container failed to become ready")


try:
    run([*compose, "up", "-d", "--build", "--wait", "--wait-timeout", "120"])
    probe = (root / "tests/container_probe.py").read_bytes()
    for phase in ("before", "after"):
        if phase == "after":
            run([*compose, "restart", "api"])
        wait_ready()
        run([*compose, "exec", "-T", "api", "python", "-", phase], input=probe)
    run(
        [
            *compose,
            "exec",
            "-T",
            "api",
            "python",
            "-c",
            "import os,pathlib; assert os.getuid()==10001; assert not pathlib.Path('/app/.env').exists()",
        ]
    )
    print(
        "PASS: production image auth/CSRF/proxy/throttling/CRUD and restart persistence; non-root, no .env"
    )
finally:
    # Compose scopes cleanup to the generated project, never to application containers or volumes.
    run([*compose, "down", "--volumes", "--remove-orphans"])
