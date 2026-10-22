from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from pymongo.errors import DuplicateKeyError

from app.auth import hasher
from app.provision_user import insert_user, main, provision


def database():
    users = Mock()
    users.with_options.return_value = users
    users.insert_one = AsyncMock()
    return SimpleNamespace(users=users, tokens=Mock())


async def test_insert_canonical_argon2_account_with_majority_acknowledgement():
    db = database()
    await insert_user(db, " CHRIS ", "a-private-password")
    doc = db.users.insert_one.call_args.args[0]
    assert set(doc) == {"_id", "password_hash"}
    assert doc["_id"] == "chris"
    assert doc["password_hash"].startswith("$argon2id$")
    assert hasher.verify(doc["password_hash"], "a-private-password")
    assert db.users.with_options.call_args.kwargs["write_concern"].document == {"w": "majority"}
    assert db.tokens.mock_calls == []


async def test_duplicate_aborts_without_upsert_or_session_revocation():
    db = database()
    db.users.insert_one.side_effect = DuplicateKeyError("existing account")
    with pytest.raises(DuplicateKeyError):
        await insert_user(db, "chris", "a-private-password")
    db.users.insert_one.assert_awaited_once()
    db.users.update_one.assert_not_called()
    assert db.tokens.mock_calls == []


@pytest.mark.parametrize("password", ["short", "x" * 257])
async def test_invalid_password_does_not_access_database(password):
    db = database()
    with pytest.raises(ValueError):
        await insert_user(db, "chris", password)
    assert db.users.mock_calls == []
    assert db.tokens.mock_calls == []


def test_cli_requires_explicit_database():
    with pytest.raises(SystemExit) as error:
        main(["chris"])
    assert error.value.code == 2


async def test_provision_enforces_tls_explicit_database_and_no_write_retry(monkeypatch):
    db = database()
    client = Mock()
    client.__getitem__ = Mock(return_value=db)
    context = AsyncMock()
    context.__aenter__.return_value = client
    factory = Mock(return_value=context)
    monkeypatch.setattr("app.provision_user.AsyncMongoClient", factory)
    await provision("selected_db", "chris", "mongodb+srv://private-uri", "private-password")
    client.__getitem__.assert_called_once_with("selected_db")
    options = factory.call_args.kwargs
    assert options["tls"] is True
    assert options["tlsAllowInvalidCertificates"] is False
    assert options["tlsAllowInvalidHostnames"] is False
    assert options["retryWrites"] is False
    context.__aexit__.assert_awaited_once()


def test_cli_suppresses_driver_secrets_and_does_not_retry(monkeypatch, capsys):
    values = iter(["mongodb+srv://private-uri", "private-password", "private-password"])
    monkeypatch.setattr("app.provision_user.hidden_input", lambda _: next(values))
    action = AsyncMock(side_effect=RuntimeError("private-uri private-password private-hash"))
    monkeypatch.setattr("app.provision_user.provision", action)
    assert main(["--database", "kanban_prod", "chris"]) == 1
    action.assert_awaited_once()
    output = capsys.readouterr()
    assert "private-" not in output.out + output.err
    assert "uncertain" in output.err


def test_cli_refuses_echo_fallback(monkeypatch, capsys):
    import getpass
    import warnings

    def no_terminal(_):
        warnings.warn("echo unavailable", getpass.GetPassWarning, stacklevel=2)

    monkeypatch.setattr("app.provision_user.getpass.getpass", no_terminal)
    action = AsyncMock()
    monkeypatch.setattr("app.provision_user.provision", action)
    assert main(["--database", "kanban_prod", "chris"]) == 1
    action.assert_not_called()
    assert "secure interactive input" in capsys.readouterr().err
