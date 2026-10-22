"""Guard against removing unrelated Docker resources or leaking fixture secrets."""

import json
from unittest.mock import patch

import pytest
from worker_runtime import check_sidecars, cleanup_runtime, runtime_containers, runtime_snapshot

PROJECT = "kanban-worker-test-0123456789ab"
NAME = f"workerd-{PROJECT}-KanbanAPI-{'a' * 64}"


def rows(*names):
    return "\n".join(json.dumps({"Names": name, "ID": f"id-{i}"}) for i, name in enumerate(names))


def test_cleanup_excludes_substring_matches_and_unrelated_resources():
    listing = rows(
        NAME,
        NAME + "-proxy",
        "unrelated",
        NAME + "-proxy-extra",
        "prefix-" + NAME,
        NAME.replace(PROJECT, PROJECT + "0"),
        NAME.replace("KanbanAPI", "Other"),
    )
    with patch("worker_runtime.docker", side_effect=[listing, "", "", ""]) as docker:
        cleanup_runtime(PROJECT)
    removals = [call.args for call in docker.call_args_list if call.args[0] == "rm"]
    assert removals == [("rm", "-f", "-v", "id-0"), ("rm", "-f", "-v", "id-1")]


def test_non_disposable_project_rejected_before_docker():
    with patch("worker_runtime.docker") as docker, pytest.raises(ValueError):
        runtime_containers("kanban-sneakybeak-net")
    docker.assert_not_called()


def test_cleanup_failure_is_reported():
    with patch("worker_runtime.docker", side_effect=[rows(NAME), "", rows(NAME)]):
        with pytest.raises(RuntimeError, match="remain after cleanup"):
            cleanup_runtime(PROJECT)


def test_snapshot_omits_arbitrary_error_text_and_environment():
    state = {"Status": "exited", "ExitCode": 1, "OOMKilled": False, "Error": "private-value"}
    with patch(
        "worker_runtime.docker", side_effect=[rows(NAME + "-proxy"), json.dumps(state)]
    ) as docker:
        snapshot = runtime_snapshot(PROJECT)
    assert snapshot == [
        {"name": NAME + "-proxy", "status": "exited", "exit_code": 1, "oom_killed": False}
    ]
    assert docker.call_args.args == ("inspect", "--format", "{{json .State}}", "id-0")


@pytest.mark.parametrize("status", ["exited", "dead"])
def test_stopped_sidecar_fails_readiness_promptly(status):
    state = {"name": NAME + "-proxy", "status": status, "exit_code": 1, "oom_killed": False}
    with patch("worker_runtime.runtime_snapshot", return_value=[state]):
        with pytest.raises(RuntimeError, match="API acceptance did not run"):
            check_sidecars(PROJECT)


@pytest.mark.parametrize("states", [[], [{"name": NAME + "-proxy", "status": "running"}]])
def test_absent_or_starting_sidecar_keeps_waiting(states):
    with patch("worker_runtime.runtime_snapshot", return_value=states):
        check_sidecars(PROJECT)
