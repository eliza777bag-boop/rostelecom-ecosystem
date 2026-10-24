"""
test_auth.py — автоматические проверки входа. Запуск из папки проекта:

    python backend/test_auth.py

Тесты запускают сервер на случайном порту с ВРЕМЕННЫМ тестовым пользователем
(ваш private/auth.json не читается и не меняется) и проверяют, что без правильного
пароля И правильного одноразового кода сайт и CSV не отдаются.
"""
import http.client
import json
import os
import sys
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

TMP = tempfile.mkdtemp(prefix="ec_auth_test_")
os.environ["AUTH_CONFIG_FILE"] = os.path.join(TMP, "auth.json")
for k in ("AUTH_USERNAME", "AUTH_PASSWORD_HASH", "AUTH_TOTP_SECRET", "TRUST_PROXY", "COOKIE_SECURE"):
    os.environ.pop(k, None)
CSV_PATH = os.path.join(TMP, "radar_data.csv")
with open(CSV_PATH, "w", encoding="utf-8") as f:
    f.write("name;inn;lat;lng\nТестовая компания;0000000000;47.2;39.7\n")
os.environ["RADAR_CSV_PATH"] = CSV_PATH

import auth_core  # noqa: E402
import server  # noqa: E402

server.Handler.log_message = lambda self, *a: None  # не засоряем вывод тестов

USER, PASSWORD = "tester", "Correct-Horse-42"
SECRET = auth_core.new_totp_secret()
auth_core.save_user(USER, auth_core.hash_password(PASSWORD), SECRET)


class Client:
    """Мини-«браузер»: хранит cookie между запросами."""

    def __init__(self, port):
        self.port, self.cookie = port, None

    def req(self, method, path, body=None, headers=None, raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = dict(headers or {})
        if self.cookie:
            h["Cookie"] = self.cookie
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        if body is not None and "Content-Type" not in h:
            h["Content-Type"] = "application/json"
        conn.request(method, path, body=data, headers=h)
        r = conn.getresponse()
        payload = r.read()
        sc = r.getheader("Set-Cookie")
        if sc:
            val = sc.split(";")[0]
            self.cookie = None if val.endswith("=") else val
        conn.close()
        return r, payload

    def login(self, password=PASSWORD, user=USER):
        return self.req("POST", "/api/login", {"username": user, "password": password})

    def verify(self, code):
        return self.req("POST", "/api/verify", {"code": code})


def wrong_code(at=None):
    """Код, который точно не подходит ни для одного шага окна ±1."""
    valid = {auth_core.hotp(auth_core._secret_bytes(SECRET), int((at or time.time()) // 30) + d)
             for d in (-1, 0, 1)}
    for n in range(1000000):
        c = str(n).zfill(6)
        if c not in valid:
            return c


class AuthTests(unittest.TestCase):
    def setUp(self):
        s = server.Settings()
        s.host, s.port = "127.0.0.1", 0
        self.httpd, self.app = server.make_server(s)
        self.port = self.httpd.server_address[1]
        self.t = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.t.start()
        self.c = Client(self.port)

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def full_login(self, c=None):
        c = c or self.c
        r, _ = c.login()
        self.assertEqual(r.status, 200)
        r, _ = c.verify(auth_core.totp_now(SECRET))
        self.assertEqual(r.status, 200)
        return c

    # ---------- 1. без входа ничего не отдаётся
    def test_01_no_session_redirects_and_401(self):
        r, _ = self.c.req("GET", "/")
        self.assertEqual(r.status, 302)
        self.assertEqual(r.getheader("Location"), "/login")
        for p in ("/index.html", "/js/map.js", "/css/style.css", "/data/radar_data.csv", "/api/me"):
            r, body = self.c.req("GET", p)
            self.assertIn(r.status, (302, 401), p)
            self.assertNotIn("Тестовая компания".encode(), body)

    def test_02_login_page_is_public(self):
        for p in ("/login", "/login.js", "/login.css"):
            r, _ = self.c.req("GET", p)
            self.assertEqual(r.status, 200, p)

    # ---------- 2. пароль
    def test_03_wrong_password(self):
        r, b = self.c.login(password="wrong-password")
        self.assertEqual(r.status, 401)
        r, _ = self.c.verify(auth_core.totp_now(SECRET))  # код без пароля не работает
        self.assertEqual(r.status, 401)
        r, _ = self.c.req("GET", "/data/radar_data.csv")
        self.assertEqual(r.status, 401)

    def test_04_unknown_user_same_message(self):
        r1, b1 = self.c.login(user="nobody")
        r2, b2 = Client(self.port).login(password="wrong-password")
        self.assertEqual((r1.status, json.loads(b1)["error"]), (r2.status, json.loads(b2)["error"]))

    # ---------- 3. только пароль = ещё не вход
    def test_05_password_only_is_not_enough(self):
        r, _ = self.c.login()
        self.assertEqual(r.status, 200)
        self.assertIsNotNone(self.c.cookie)
        for p in ("/", "/data/radar_data.csv", "/js/data.js", "/api/me"):
            r, body = self.c.req("GET", p)
            self.assertIn(r.status, (302, 401), p)
            self.assertNotIn("Тестовая компания".encode(), body)

    def test_06_wrong_code(self):
        self.c.login()
        r, _ = self.c.verify(wrong_code())
        self.assertEqual(r.status, 401)
        r, _ = self.c.req("GET", "/data/radar_data.csv")
        self.assertEqual(r.status, 401)

    def test_07_bad_code_formats(self):
        self.c.login()
        for code in ("", "12345", "1234567", "abcdef", "12 34 5", None, 123456):
            r, _ = self.c.verify(code)
            self.assertEqual(r.status, 401, code)
            if json.loads(_).get("restart"):
                break

    def test_08_too_many_codes_restart(self):
        self.c.login()
        last = None
        for _ in range(server.MAX_CODE_ATTEMPTS):
            r, last = self.c.verify(wrong_code())
        self.assertTrue(json.loads(last).get("restart"))
        r, _ = self.c.verify(auth_core.totp_now(SECRET))  # даже верный код уже не спасает
        self.assertEqual(r.status, 401)

    # ---------- 4. правильный вход
    def test_09_full_login_works_and_session_rotates(self):
        r, _ = self.c.login()
        pending = self.c.cookie
        r, _ = self.c.verify(auth_core.totp_now(SECRET))
        self.assertEqual(r.status, 200)
        self.assertNotEqual(pending, self.c.cookie, "после 2FA должен выдаваться новый идентификатор")
        for p in ("/", "/index.html", "/js/auth.js", "/js/map.js", "/js/data.js", "/js/main.js",
                  "/js/investments.js", "/js/calculator.js", "/css/style.css"):
            r, _ = self.c.req("GET", p)
            self.assertEqual(r.status, 200, p)
        r, body = self.c.req("GET", "/data/radar_data.csv")
        self.assertEqual(r.status, 200)
        self.assertIn("Тестовая компания".encode(), body)
        r, body = self.c.req("GET", "/api/me")
        self.assertEqual(json.loads(body)["user"], USER)
        # полусессия после входа больше недействительна
        old = Client(self.port); old.cookie = pending
        r, _ = old.req("GET", "/api/me")
        self.assertEqual(r.status, 401)

    def test_10_cookie_flags(self):
        r, _ = self.c.login()
        sc = r.getheader("Set-Cookie")
        self.assertIn("HttpOnly", sc)
        self.assertIn("SameSite=Strict", sc)

    def test_11_code_cannot_be_reused(self):
        self.full_login()
        c2 = Client(self.port)
        c2.login()
        r, _ = c2.verify(auth_core.totp_now(SECRET))   # тот же код второй раз
        self.assertEqual(r.status, 401)

    def test_12_logout(self):
        self.full_login()
        sid = self.c.cookie
        self.c.req("POST", "/api/logout", {})
        thief = Client(self.port); thief.cookie = sid    # старая cookie больше не работает
        r, _ = thief.req("GET", "/data/radar_data.csv")
        self.assertEqual(r.status, 401)

    def test_13_forged_cookie(self):
        self.c.cookie = "ec_session=" + "A" * 43
        r, _ = self.c.req("GET", "/data/radar_data.csv")
        self.assertEqual(r.status, 401)

    def test_14_secret_files_never_served(self):
        self.full_login()
        for p in ("/backend/server.py", "/backend/auth_core.py", "/private/auth.json",
                  "/../private/auth.json", "/js/../private/auth.json", "/js/%2e%2e/private/auth.json",
                  "/js/..%2fbackend%2fserver.py", "/.gitignore", "/README.md", "/data/.gitkeep",
                  "/js/..\\backend\\server.py"):
            r, body = self.c.req("GET", p)
            self.assertEqual(r.status, 404, p)
            self.assertNotIn(SECRET.encode(), body)

    def test_15_rate_limit(self):
        for _ in range(server.MAX_FAILS_PER_USER):
            Client(self.port).login(password="wrong-password")
        r, _ = Client(self.port).login()   # даже верный пароль временно не принимается
        self.assertEqual(r.status, 429)

    def test_16_cross_site_post_rejected(self):
        r, _ = self.c.req("POST", "/api/login", {"username": USER, "password": PASSWORD},
                          headers={"Origin": "https://evil.example", "Content-Type": "application/json"})
        self.assertEqual(r.status, 403)
        r, _ = self.c.req("POST", "/api/login", raw=b"username=tester",
                          headers={"Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(r.status, 415)

    def test_17_pending_expires(self):
        self.c.login()
        sid = self.c.cookie.split("=", 1)[1]
        self.app.sessions.items[sid]["created"] -= server.PENDING_TTL + 1
        r, _ = self.c.verify(auth_core.totp_now(SECRET))
        self.assertEqual(r.status, 401)

    def test_18_idle_session_expires(self):
        self.full_login()
        sid = self.c.cookie.split("=", 1)[1]
        self.app.sessions.items[sid]["seen"] -= self.app.settings.idle_ttl + 1
        r, _ = self.c.req("GET", "/data/radar_data.csv")
        self.assertEqual(r.status, 401)

    def test_19_no_store_cache(self):
        self.full_login()
        r, _ = self.c.req("GET", "/data/radar_data.csv")
        self.assertEqual(r.getheader("Cache-Control"), "no-store")


class CoreTests(unittest.TestCase):
    def test_rfc6238_vectors(self):
        # Официальные тестовые значения RFC 6238 (SHA-1, ключ "12345678901234567890"), последние 6 цифр
        import base64
        secret = base64.b32encode(b"12345678901234567890").decode()
        for t, code in ((59, "287082"), (1111111109, "081804"), (1234567890, "005924"),
                        (2000000000, "279037"), (20000000000, "353130")):
            self.assertEqual(auth_core.totp_now(secret, at=t), code)

    def test_window(self):
        s = auth_core.new_totp_secret()
        t = 1_700_000_000
        self.assertIsNotNone(auth_core.totp_match(s, auth_core.totp_now(s, t - 30), at=t))
        self.assertIsNone(auth_core.totp_match(s, auth_core.totp_now(s, t - 90), at=t))

    def test_password_hash(self):
        h = auth_core.hash_password("секрет-пароль-1")
        self.assertNotIn("секрет", h)
        self.assertTrue(auth_core.verify_password("секрет-пароль-1", h))
        self.assertFalse(auth_core.verify_password("секрет-пароль-2", h))
        self.assertNotEqual(h, auth_core.hash_password("секрет-пароль-1"))  # разная соль
        self.assertFalse(auth_core.verify_password("x", "мусор"))

    def test_env_config(self):
        os.environ.update(AUTH_USERNAME="envuser", AUTH_PASSWORD_HASH="h", AUTH_TOTP_SECRET="S")
        try:
            self.assertEqual(list(auth_core.load_users()), ["envuser"])
        finally:
            for k in ("AUTH_USERNAME", "AUTH_PASSWORD_HASH", "AUTH_TOTP_SECRET"):
                os.environ.pop(k)


if __name__ == "__main__":
    # Тесты 11 и 15 зависят от общего состояния — поэтому сервер создаётся заново для каждого теста.
    unittest.main(verbosity=2)
