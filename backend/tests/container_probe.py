"""Executed inside the disposable API container by container_smoke.py, never against Atlas."""

import json
import os
import sys
import urllib.error
import urllib.request

from pymongo import MongoClient

from app.auth import hasher

ORIGIN = "https://kanban.sneakybeak.net"
DB_NAME = "kanban_test_container"
assert os.environ["MONGO_DB"] == DB_NAME
assert os.environ["MONGO_URL"] == "mongodb://mongo:27017/?replicaSet=rs0"
db = MongoClient(os.environ["MONGO_URL"])[DB_NAME]
password = "disposable-container-password"


def call(path, method="GET", body=None, cookie=None, proxy=True, origin=ORIGIN):
    headers = {"Content-Type": "application/json"}
    if proxy:
        headers["X-Kanban-Proxy-Secret"] = os.environ["PROXY_SECRET"]
    if origin:
        headers["Origin"] = origin
    if cookie:
        headers["Cookie"] = cookie
    request = urllib.request.Request(
        "http://127.0.0.1:8000/api" + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
        method=method,
    )
    try:
        response = urllib.request.urlopen(request, timeout=20)
    except urllib.error.HTTPError as exc:
        response = exc
    raw = response.read()
    return response.status, response.headers, json.loads(raw) if raw else None


if sys.argv[1] == "before":
    assert not db.users.count_documents({}), "Refusing nonempty disposable fixture"
    db.users.insert_one({"_id": "test-user", "password_hash": hasher.hash(password)})
    assert call("/health/live", proxy=False)[0] == 200
    assert call("/health/ready", proxy=False)[0] == 403
    denied = call(
        "/auth/login", "POST", {"username": "test-user", "password": password}, proxy=False
    )
    assert denied[0] == 403 and "Set-Cookie" not in denied[1]
    assert db.login_limits.count_documents({}) == 0
    assert call("/auth/login", "POST", {}, origin="https://evil.example")[0] == 403
    assert db.login_limits.count_documents({}) == 0
    status, headers, user = call(
        "/auth/login", "POST", {"username": " TEST-USER ", "password": password}
    )
    assert status == 200 and user == {"username": "test-user"}
    assert all(flag in headers["Set-Cookie"] for flag in ("HttpOnly", "Secure", "SameSite=lax"))
    cookie = headers["Set-Cookie"].split(";", 1)[0]
    assert call("/auth/me", cookie=cookie, origin=None)[0] == 200
    status, _, card = call(
        "/cards", "POST", {"title": "Persistent container fixture", "tag": "test"}, cookie
    )
    assert status == 201
    path = "/cards/" + card["id"]
    assert call(path, "PATCH", {"title": "Retained", "expected_version": 1}, cookie)[0] == 200
    status, _, card = call(path + "/comments", "POST", {"text": "Persistent comment"}, cookie)
    assert status == 201
    board = call("/cards", cookie=cookie)[2]
    status, _, moved = call(
        path + "/move",
        "POST",
        {
            "column": "done",
            "expected_version": 2,
            "expected_order_versions": board["order_versions"],
        },
        cookie,
    )
    assert status == 200 and moved["card"]["column"] == "done"
    for _ in range(4):
        assert call("/auth/login", "POST", {"username": "test-user", "password": "wrong"})[0] == 401
    throttled = call("/auth/login", "POST", {"username": "test-user", "password": password})
    assert throttled[0] == 429 and int(throttled[1]["Retry-After"]) > 0
    assert call("/auth/logout", "POST", cookie=cookie, origin=None)[0] == 403
    assert call("/auth/me", cookie=cookie)[0] == 200
    db.test_probe.insert_one({"_id": "session", "cookie": cookie, "card": card["id"]})
else:
    fixture = db.test_probe.find_one({"_id": "session"})
    cookie = fixture["cookie"]
    assert call("/auth/me", cookie=cookie)[0] == 200
    board = call("/cards", cookie=cookie)[2]
    card = board["cards"][0]
    assert (
        card["id"] == fixture["card"] and card["title"] == "Retained" and card["column"] == "done"
    )
    assert card["comments"][0]["text"] == "Persistent comment"
    assert call("/auth/login", "POST", {"username": "test-user", "password": password})[0] == 429
    assert (
        call(
            f"/cards/{card['id']}?expected_version=3&expected_comments_version=1",
            "DELETE",
            cookie=cookie,
        )[0]
        == 204
    )
    assert call("/auth/logout", "POST", cookie=cookie)[0] == 204
    assert call("/auth/me", cookie=cookie)[0] == 401
print("Container probe passed: " + sys.argv[1])
