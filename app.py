import hashlib
import os
import secrets
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request


ROOT = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("DATABASE_PATH", ROOT / "data" / "secret_santa.sqlite3"))


def _hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _json_body():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return None
    return body


def _error(message, status):
    return jsonify(error=message), status


def create_app(test_config=None):
    app = Flask(__name__, instance_path=str(ROOT / "instance"))
    app.config.from_mapping(DATABASE=str(DATABASE))
    if test_config:
        app.config.update(test_config)

    database_path = Path(app.config["DATABASE"])
    database_path.parent.mkdir(parents=True, exist_ok=True)

    def connect_db():
        connection = sqlite3.connect(database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    with closing(connect_db()) as connection, connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS draws (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                invite_hash TEXT NOT NULL UNIQUE,
                organizer_hash TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL CHECK (status IN ('open', 'drawn')),
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS participants (
                id TEXT PRIMARY KEY,
                draw_id TEXT NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                access_hash TEXT NOT NULL UNIQUE,
                recipient_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL,
                UNIQUE(draw_id, name COLLATE NOCASE)
            );
            """
        )

    def draw_from_invite(connection, invite_token):
        return connection.execute(
            "SELECT * FROM draws WHERE invite_hash = ?", (_hash_token(invite_token),)
        ).fetchone()

    def draw_from_organizer(connection, organizer_token):
        return connection.execute(
            "SELECT * FROM draws WHERE organizer_hash = ?",
            (_hash_token(organizer_token),),
        ).fetchone()

    def participant_from_request(connection, draw_id):
        authorization = request.headers.get("Authorization", "")
        scheme, separator, token = authorization.partition(" ")
        if not separator or scheme.lower() != "bearer" or not token:
            return None
        return connection.execute(
            "SELECT * FROM participants WHERE draw_id = ? AND access_hash = ?",
            (draw_id, _hash_token(token)),
        ).fetchone()

    @app.after_request
    def add_security_headers(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"
        )
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.get("/")
    def home():
        return render_template("index.html")

    @app.get("/g/<invite_token>")
    def group_page(invite_token):
        return render_template("group.html", invite_token=invite_token)

    @app.get("/organizer/<organizer_token>")
    def organizer_page(organizer_token):
        return render_template("organizer.html", organizer_token=organizer_token)

    @app.post("/api/draws")
    def create_draw():
        body = _json_body()
        if body is None:
            return _error("Richiesta non valida.", 400)
        title = body.get("title", "")
        if not isinstance(title, str) or not title.strip() or len(title.strip()) > 80:
            return _error("Inserisci un nome del gruppo (massimo 80 caratteri).", 400)

        draw_id = secrets.token_hex(16)
        invite_token = secrets.token_urlsafe(32)
        organizer_token = secrets.token_urlsafe(32)
        with closing(connect_db()) as connection, connection:
            connection.execute(
                """
                INSERT INTO draws (id, title, invite_hash, organizer_hash, status, created_at)
                VALUES (?, ?, ?, ?, 'open', ?)
                """,
                (
                    draw_id,
                    title.strip(),
                    _hash_token(invite_token),
                    _hash_token(organizer_token),
                    _now(),
                ),
            )
        return jsonify(
            invite_url=f"{request.url_root.rstrip('/')}/g/{invite_token}",
            organizer_url=(
                f"{request.url_root.rstrip('/')}/organizer/{organizer_token}"
                f"?invite={invite_token}"
            ),
        ), 201

    @app.get("/api/groups/<invite_token>/state")
    def group_state(invite_token):
        with closing(connect_db()) as connection, connection:
            draw = draw_from_invite(connection, invite_token)
            if draw is None:
                return _error("Questo gruppo non esiste.", 404)
            count = connection.execute(
                "SELECT COUNT(*) AS count FROM participants WHERE draw_id = ?",
                (draw["id"],),
            ).fetchone()["count"]
        return jsonify(title=draw["title"], status=draw["status"], participant_count=count)

    @app.post("/api/groups/<invite_token>/participants")
    def join_group(invite_token):
        body = _json_body()
        if body is None:
            return _error("Richiesta non valida.", 400)
        name = body.get("name", "")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
            return _error("Inserisci il tuo nome (massimo 80 caratteri).", 400)

        participant_id = secrets.token_hex(16)
        access_token = secrets.token_urlsafe(32)
        try:
            with closing(connect_db()) as connection, connection:
                connection.execute("BEGIN IMMEDIATE")
                draw = draw_from_invite(connection, invite_token)
                if draw is None:
                    return _error("Questo gruppo non esiste.", 404)
                if draw["status"] != "open":
                    return _error("Le iscrizioni sono chiuse.", 409)
                connection.execute(
                    """
                    INSERT INTO participants (id, draw_id, name, access_hash, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        participant_id,
                        draw["id"],
                        name.strip(),
                        _hash_token(access_token),
                        _now(),
                    ),
                )
        except sqlite3.IntegrityError:
            return _error("Questo nome è già iscritto al gruppo.", 409)
        return jsonify(access_token=access_token), 201

    @app.get("/api/groups/<invite_token>/me")
    def my_assignment(invite_token):
        with closing(connect_db()) as connection, connection:
            draw = draw_from_invite(connection, invite_token)
            if draw is None:
                return _error("Questo gruppo non esiste.", 404)
            participant = participant_from_request(connection, draw["id"])
            if participant is None:
                return _error("Iscriviti per partecipare al sorteggio.", 401)
            if draw["status"] == "open":
                return jsonify(status="waiting", title=draw["title"])
            recipient = connection.execute(
                "SELECT name FROM participants WHERE id = ? AND draw_id = ?",
                (participant["recipient_id"], draw["id"]),
            ).fetchone()
            if recipient is None:
                return _error("Il sorteggio è stato azzerato. Iscriviti di nuovo.", 410)
        return jsonify(status="drawn", title=draw["title"], recipient=recipient["name"])

    @app.get("/api/organizer/<organizer_token>/state")
    def organizer_state(organizer_token):
        with closing(connect_db()) as connection, connection:
            draw = draw_from_organizer(connection, organizer_token)
            if draw is None:
                return _error("Link organizzatore non valido.", 404)
            count = connection.execute(
                "SELECT COUNT(*) AS count FROM participants WHERE draw_id = ?",
                (draw["id"],),
            ).fetchone()["count"]
        return jsonify(title=draw["title"], status=draw["status"], participant_count=count)

    @app.post("/api/organizer/<organizer_token>/draw")
    def start_draw(organizer_token):
        try:
            with closing(connect_db()) as connection, connection:
                connection.execute("BEGIN IMMEDIATE")
                draw = draw_from_organizer(connection, organizer_token)
                if draw is None:
                    return _error("Link organizzatore non valido.", 404)
                if draw["status"] != "open":
                    return _error("Il sorteggio è già stato avviato.", 409)
                participant_ids = [
                    row["id"]
                    for row in connection.execute(
                        "SELECT id FROM participants WHERE draw_id = ?", (draw["id"],)
                    ).fetchall()
                ]
                if len(participant_ids) < 2:
                    return _error("Servono almeno due iscritti per avviare il sorteggio.", 409)
                rng = secrets.SystemRandom()
                recipients = participant_ids.copy()
                while True:
                    rng.shuffle(recipients)
                    if all(
                        giver != recipient
                        for giver, recipient in zip(participant_ids, recipients)
                    ):
                        break
                connection.executemany(
                    "UPDATE participants SET recipient_id = ? WHERE id = ?",
                    zip(recipients, participant_ids),
                )
                connection.execute(
                    "UPDATE draws SET status = 'drawn' WHERE id = ?", (draw["id"],)
                )
        except sqlite3.Error:
            app.logger.exception("Unable to create the Secret Santa draw")
            return _error("Non è stato possibile avviare il sorteggio.", 500)
        return jsonify(status="drawn")

    @app.post("/api/organizer/<organizer_token>/reset")
    def reset_draw(organizer_token):
        with closing(connect_db()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            draw = draw_from_organizer(connection, organizer_token)
            if draw is None:
                return _error("Link organizzatore non valido.", 404)
            connection.execute("DELETE FROM participants WHERE draw_id = ?", (draw["id"],))
            connection.execute(
                "UPDATE draws SET status = 'open' WHERE id = ?", (draw["id"],)
            )
        return jsonify(status="open", participant_count=0)

    @app.get("/health")
    def health():
        return jsonify(status="ok")

    return app


app = create_app()


if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1")
