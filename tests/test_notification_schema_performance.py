import core.db as db


def test_initialized_notification_path_does_not_repeat_schema_migrations(monkeypatch):
    monkeypatch.setattr(db, "_DB_INIT_DONE", True)

    def unexpected(*_args, **_kwargs):
        raise AssertionError("schema initializer repeated after normal application boot")

    monkeypatch.setattr(db, "ensure_phase2_schema", unexpected)
    monkeypatch.setattr(db, "run_query", lambda *_args, **_kwargs: None)
    db._queue_notification_channel(None, "in_app", 1, None)
