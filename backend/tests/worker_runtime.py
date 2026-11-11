"""Scoped Docker diagnostics/cleanup for the disposable Wrangler acceptance harness."""

import json
import re
import subprocess


def docker(*args):
    return subprocess.run(
        ["docker", *args], check=True, capture_output=True, text=True, timeout=30
    ).stdout


def runtime_containers(project):
    # Docker's name filter is a substring match; independently validate every result.
    if not re.fullmatch(r"kanban-worker-test-[0-9a-f]{12}", project):
        raise ValueError("Refusing non-disposable Worker project")
    pattern = re.compile(rf"workerd-{re.escape(project)}-KanbanAPI-[0-9a-f]{{64}}(?:-proxy)?")
    rows = docker(
        "ps", "-a", "--no-trunc", "--filter", f"name=workerd-{project}-", "--format", "{{json .}}"
    )
    return [
        row for line in rows.splitlines() if pattern.fullmatch((row := json.loads(line))["Names"])
    ]


def runtime_snapshot(project):
    result = []
    for row in runtime_containers(project):
        # Never inspect/record Config.Env, request logs, or arbitrary Docker error text.
        state = json.loads(docker("inspect", "--format", "{{json .State}}", row["ID"]))
        result.append(
            {
                "name": row["Names"],
                "status": state["Status"],
                "exit_code": state["ExitCode"],
                "oom_killed": state["OOMKilled"],
            }
        )
    return result


def check_sidecars(project):
    for state in runtime_snapshot(project):
        if state["name"].endswith("-proxy") and state["status"] in {"exited", "dead"}:
            raise RuntimeError(
                f"Cloudflare networking sidecar stopped (exit {state['exit_code']}, "
                f"OOMKilled={state['oom_killed']}); see runtime-state.json and the "
                "deployment guide's WSL networking diagnosis. API acceptance did not run."
            )


def cleanup_runtime(project):
    for row in runtime_containers(project):
        # Remove by immutable ID, only after the exact generated project/name check.
        docker("rm", "-f", "-v", row["ID"])
    if runtime_containers(project):
        raise RuntimeError("Disposable Worker containers remain after cleanup")
