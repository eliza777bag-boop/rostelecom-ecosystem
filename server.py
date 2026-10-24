"""
server.py — сервер «Экосистемы коммерческого блока» с двухфакторным входом.
Только стандартная библиотека Python 3.8+, ничего устанавливать не нужно.

Запуск (из папки проекта):      python backend/server.py
Потом откройте в браузере:      http://localhost:8000

Как это работает
  1. Любой запрос к сайту (index.html, css, js, data/radar_data.csv) без входа
     получает перенаправление на /login (для страниц) или ошибку 401 (для файлов).
  2. Шаг 1: POST /api/login {username, password}. Пароль сверяется с хешем на сервере.
     При успехе выдаётся «полусессия» — она ещё НЕ открывает сайт, только даёт право
     ввести код (5 минут, не больше 5 попыток).
  3. Шаг 2: POST /api/verify {code}. Код TOTP проверяется на сервере. При успехе
     выдаётся новая полноценная сессия (новый идентификатор), и сайт открывается.
  4. Сессия хранится в памяти сервера, в браузере — только случайный идентификатор
     в cookie с флагами HttpOnly и SameSite=Strict (+ Secure на HTTPS).

Настройки через переменные окружения (все необязательные):
  HOST=127.0.0.1       PORT=8000        COOKIE_SECURE=1 (включить на HTTPS-хостинге)
  TRUST_PROXY=1        — брать IP клиента из X-Forwarded-For (только за прокси хостинга)
  RADAR_CSV_PATH=...   — путь к CSV с компаниями, если он лежит не в data/radar_data.csv
  SESSION_IDLE_MINUTES=30   SESSION_MAX_HOURS=8
  AUTH_USERNAME / AUTH_PASSWORD_HASH / AUTH_TOTP_SECRET — учётные данные (см. auth_core.py)
"""
import json
import mimetypes
import os
import secrets
import sys
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import auth_core  # noqa: E402

PROJECT_DIR = auth_core.PROJECT_DIR
BACKEND_DIR = auth_core.BACKEND_DIR

# Что из папки проекта можно отдавать (и только после входа). Папки backend/, private/,
# backup/, файлы .py/.json/.md в корне — не отдаются никогда.
ALLOWED_ROOT_FILES = {"index.html"}
ALLOWED_DIRS = {"css", "js", "assets", "data"}
# Публичные файлы страницы входа (лежат в backend/, а не в папке сайта)
LOGIN_FILES = {"/login": ("login.html", "text/html; charset=utf-8"),
               "/login.css": ("login.css", "text/css; charset=utf-8"),
               "/login.js": ("login.js", "text/javascript; charset=utf-8")}

COOKIE_NAME = "ec_session"
PENDING_TTL = 5 * 60                 # сколько живёт «полусессия» между паролем и кодом
MAX_CODE_ATTEMPTS = 5                # попыток ввести код в одной полусессии
FAIL_WINDOW = 15 * 60                # окно подсчёта неудачных попыток
MAX_FAILS_PER_IP = 10                # неудач с одного IP за окно → временная блокировка
MAX_FAILS_PER_USER = 5               # неудач для одного логина за окно → временная блокировка
MAX_BODY = 4096


def env_flag(name):
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


class Settings:
    def __init__(self):
        self.host = os.environ.get("HOST", "127.0.0.1")
        self.port = int(os.environ.get("PORT", "8000"))
        self.cookie_secure = env_flag("COOKIE_SECURE")
        self.trust_proxy = env_flag("TRUST_PROXY")
        self.idle_ttl = float(os.environ.get("SESSION_IDLE_MINUTES", "30")) * 60
        self.max_ttl = float(os.environ.get("SESSION_MAX_HOURS", "8")) * 3600
        self.csv_path = os.environ.get("RADAR_CSV_PATH") or os.path.join(
            PROJECT_DIR, "data", "radar_data.csv")


# ---------------------------------------------------------------- хранилища в памяти
class SessionStore:
    """Сессии живут в памяти процесса. Перезапуск сервера = все выходят (это нормально)."""

    def __init__(self, settings):
        self.s = settings
        self.lock = threading.Lock()
        self.items = {}

    def create(self, username, stage):
        sid = secrets.token_urlsafe(32)  # 256 бит случайности
        now = time.time()
        with self.lock:
            self._cleanup(now)
            self.items[sid] = {"user": username, "stage": stage, "created": now,
                               "seen": now, "code_attempts": 0}
        return sid

    def get(self, sid):
        if not sid:
            return None
        now = time.time()
        with self.lock:
            sess = self.items.get(sid)
            if not sess:
                return None
            if sess["stage"] == "pending":
                expired = now - sess["created"] > PENDING_TTL
            else:
                expired = (now - sess["seen"] > self.s.idle_ttl or
                           now - sess["created"] > self.s.max_ttl)
            if expired:
                del self.items[sid]
                return None
            if sess["stage"] == "full":
                sess["seen"] = now
            return sess

    def delete(self, sid):
        with self.lock:
            self.items.pop(sid, None)

    def _cleanup(self, now):
        for sid in [k for k, v in self.items.items()
                    if now - v["created"] > max(self.s.max_ttl, PENDING_TTL)]:
            del self.items[sid]


class FailCounter:
    """Считает неудачные попытки входа и временно блокирует подбор."""

    def __init__(self):
        self.lock = threading.Lock()
        self.items = {}

    def _recent(self, key, now):
        lst = [t for t in self.items.get(key, []) if now - t < FAIL_WINDOW]
        self.items[key] = lst
        return lst

    def blocked_for(self, key, limit):
        now = time.time()
        with self.lock:
            lst = self._recent(key, now)
            if len(lst) >= limit:
                return int(FAIL_WINDOW - (now - lst[0])) + 1
        return 0

    def add(self, key):
        with self.lock:
            self.items.setdefault(key, []).append(time.time())

    def clear(self, key):
        with self.lock:
            self.items.pop(key, None)


class App:
    def __init__(self, settings=None):
        self.settings = settings or Settings()
        self.sessions = SessionStore(self.settings)
        self.fails = FailCounter()
        self.last_step = {}  # логин → последний использованный шаг TOTP (защита от повтора кода)
        self.step_lock = threading.Lock()

    def users(self):
        return auth_core.load_users()  # читаем каждый раз: после setup_2fa.py перезапуск не нужен


# ---------------------------------------------------------------- обработчик запросов
class Handler(BaseHTTPRequestHandler):
    server_version = "EcosystemServer"
    sys_version = ""
    app: App = None  # подставляется в make_server()

    # ---------- утилиты
    def client_ip(self):
        if self.app.settings.trust_proxy:
            fwd = self.headers.get("X-Forwarded-For", "")
            if fwd:
                # Берём ПОСЛЕДНИЙ адрес: его дописал прокси хостинга, подделать его клиент не может
                return fwd.split(",")[-1].strip()
        return self.client_address[0]

    def session_id(self):
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        try:
            c = SimpleCookie()
            c.load(raw)
        except Exception:
            return None
        return c[COOKIE_NAME].value if COOKIE_NAME in c else None

    def full_session(self):
        sess = self.app.sessions.get(self.session_id())
        return sess if sess and sess["stage"] == "full" else None

    def cookie_header(self, sid, max_age):
        parts = [f"{COOKIE_NAME}={sid}", "Path=/", "HttpOnly", "SameSite=Strict",
                 f"Max-Age={max_age}"]
        if self.app.settings.cookie_secure:
            parts.append("Secure")
        return "; ".join(parts)

    def common_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")  # защищённые данные не кэшируем
        if self.app.settings.cookie_secure:
            self.send_header("Strict-Transport-Security", "max-age=31536000")

    def send_bytes(self, status, body, ctype, extra=None):
        self.send_response(status)
        self.common_headers()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status, obj, extra=None):
        self.send_bytes(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                        "application/json; charset=utf-8", extra)

    def redirect(self, location):
        self.send_response(HTTPStatus.FOUND)
        self.common_headers()
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt, *args):
        # Пишем в консоль только метод/путь/код — без cookie, паролей и кодов
        sys.stderr.write("%s [%s] %s\n" % (self.client_ip(), self.log_date_time_string(), fmt % args))

    # ---------- GET / HEAD
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path

        if path == "/healthz":                       # для проверки «жив ли сервер» на хостинге
            return self.send_bytes(200, b"ok", "text/plain; charset=utf-8")
        if path in LOGIN_FILES:
            if path == "/login" and self.full_session():
                return self.redirect("/")
            name, ctype = LOGIN_FILES[path]
            with open(os.path.join(BACKEND_DIR, name), "rb") as f:
                body = f.read()
            csp = ("default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
                   "img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
            return self.send_bytes(200, body, ctype, {"Content-Security-Policy": csp})
        if path == "/api/me":
            sess = self.full_session()
            if not sess:
                return self.send_json(401, {"ok": False})
            return self.send_json(200, {"ok": True, "user": sess["user"]})

        # ---------- всё остальное — только после полного входа (пароль + код)
        if not self.full_session():
            if path in ("/", "/index.html") or path.endswith(".html"):
                return self.redirect("/login")
            return self.send_json(401, {"ok": False, "error": "Требуется вход"})
        self.serve_static(path)

    def serve_static(self, url_path):
        if url_path == "/":
            url_path = "/index.html"
        rel = urllib.parse.unquote(url_path).lstrip("/")
        parts = rel.split("/")
        allowed = (rel in ALLOWED_ROOT_FILES or
                   (len(parts) > 1 and parts[0] in ALLOWED_DIRS))
        if not allowed or any(p in ("", ".", "..") or p.startswith(".") for p in parts) or "\\" in rel:
            return self.send_json(404, {"ok": False, "error": "Не найдено"})

        if rel == "data/radar_data.csv":
            full = os.path.abspath(self.app.settings.csv_path)
        else:
            full = os.path.realpath(os.path.join(PROJECT_DIR, *parts))
            root = os.path.realpath(PROJECT_DIR)
            if os.path.commonpath([full, root]) != root:
                return self.send_json(404, {"ok": False, "error": "Не найдено"})
        if not os.path.isfile(full):
            return self.send_json(404, {"ok": False, "error": "Не найдено"})

        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            body = f.read()
        self.send_bytes(200, body, ctype, {"Content-Security-Policy": "frame-ancestors 'none'"})

    # ---------- POST
    def read_json(self):
        """Принимаем только JSON с того же сайта (защита от подделки запросов с чужих сайтов)."""
        origin = self.headers.get("Origin")
        if origin and urllib.parse.urlsplit(origin).netloc != self.headers.get("Host", ""):
            return None, (403, "Запрос с чужого сайта отклонён")
        if not (self.headers.get("Content-Type", "").split(";")[0].strip() == "application/json"):
            return None, (415, "Нужен JSON")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return None, (400, "Неверный запрос")
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None, (400, "Неверный запрос")
        return (data if isinstance(data, dict) else None), (None if isinstance(data, dict) else (400, "Неверный запрос"))

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        if path not in ("/api/login", "/api/verify", "/api/logout"):
            return self.send_json(404, {"ok": False, "error": "Не найдено"})
        data, err = self.read_json()
        if err:
            return self.send_json(err[0], {"ok": False, "error": err[1]})
        getattr(self, "api_" + path.rsplit("/", 1)[1])(data)

    def too_many(self, seconds):
        minutes = max(1, round(seconds / 60))
        return self.send_json(429, {"ok": False,
                                    "error": f"Слишком много неудачных попыток. Повторите через {minutes} мин."},
                              {"Retry-After": str(seconds)})

    def api_login(self, data):
        ip = "ip:" + self.client_ip()
        username = str(data.get("username", "")).strip()[:100]
        password = str(data.get("password", ""))[:1000]
        user_key = "user:" + username.lower()
        wait = max(self.app.fails.blocked_for(ip, MAX_FAILS_PER_IP),
                   self.app.fails.blocked_for(user_key, MAX_FAILS_PER_USER))
        if wait:
            return self.too_many(wait)

        users = self.app.users()
        if not users:
            return self.send_json(503, {"ok": False, "error":
                                        "Вход не настроен: запустите backend/setup_2fa.py"})
        record = users.get(username)
        if record:
            ok = auth_core.verify_password(password, record["password_hash"])
        else:
            auth_core.dummy_verify(password)  # одинаковое время ответа для несуществующего логина
            ok = False
        if not ok:
            self.app.fails.add(ip)
            self.app.fails.add(user_key)
            self.log_message("НЕУДАЧНЫЙ ВХОД (пароль) для логина %r", username)
            return self.send_json(401, {"ok": False, "error": "Неверный логин или пароль"})

        old = self.session_id()
        if old:
            self.app.sessions.delete(old)
        sid = self.app.sessions.create(username, "pending")
        self.send_json(200, {"ok": True, "next": "totp"},
                       {"Set-Cookie": self.cookie_header(sid, PENDING_TTL)})

    def api_verify(self, data):
        ip = "ip:" + self.client_ip()
        sid = self.session_id()
        sess = self.app.sessions.get(sid)
        if not sess or sess["stage"] != "pending":
            return self.send_json(401, {"ok": False, "restart": True,
                                        "error": "Время вышло. Введите логин и пароль заново"})
        username = sess["user"]
        user_key = "user:" + username.lower()
        wait = max(self.app.fails.blocked_for(ip, MAX_FAILS_PER_IP),
                   self.app.fails.blocked_for(user_key, MAX_FAILS_PER_USER))
        if wait:
            self.app.sessions.delete(sid)
            return self.too_many(wait)

        record = self.app.users().get(username)
        step = None
        if record:
            with self.app.step_lock:
                step = auth_core.totp_match(record["totp_secret"], str(data.get("code", ""))[:20],
                                            last_used_step=self.app.last_step.get(username, -1))
                if step is not None:
                    self.app.last_step[username] = step  # этот код больше не примем
        if step is None:
            self.app.fails.add(ip)
            self.app.fails.add(user_key)
            sess["code_attempts"] += 1
            self.log_message("НЕУДАЧНЫЙ ВХОД (код 2FA) для логина %r", username)
            if sess["code_attempts"] >= MAX_CODE_ATTEMPTS:
                self.app.sessions.delete(sid)
                return self.send_json(401, {"ok": False, "restart": True,
                                            "error": "Слишком много неверных кодов. Начните вход заново"})
            return self.send_json(401, {"ok": False, "error": "Неверный или устаревший код"})

        # Успех: уничтожаем полусессию и выдаём НОВЫЙ идентификатор (защита от фиксации сессии)
        self.app.sessions.delete(sid)
        self.app.fails.clear(user_key)
        new_sid = self.app.sessions.create(username, "full")
        self.log_message("УСПЕШНЫЙ ВХОД: %r", username)
        self.send_json(200, {"ok": True},
                       {"Set-Cookie": self.cookie_header(new_sid, int(self.app.settings.max_ttl))})

    def api_logout(self, data):
        sid = self.session_id()
        if sid:
            self.app.sessions.delete(sid)
        self.send_json(200, {"ok": True}, {"Set-Cookie": self.cookie_header("", 0)})

    def do_PUT(self):
        self.send_json(405, {"ok": False})

    do_DELETE = do_PATCH = do_OPTIONS = do_PUT


def make_server(settings=None, app=None):
    app = app or App(settings)
    handler = type("BoundHandler", (Handler,), {"app": app})
    httpd = ThreadingHTTPServer((app.settings.host, app.settings.port), handler)
    httpd.daemon_threads = True
    return httpd, app


def main():
    httpd, app = make_server()
    s = app.settings
    if not app.users():
        print("ВНИМАНИЕ: Вход ещё не настроен. Сначала выполните:  python backend/setup_2fa.py")
    if not os.path.isfile(s.csv_path):
        print(f"Инфо: CSV для Радара не найден ({s.csv_path}). Его можно загрузить кнопкой на сайте.")
    shown = "localhost" if s.host in ("127.0.0.1", "0.0.0.0") else s.host
    print(f"Сервер запущен: http://{shown}:{s.port}   (остановить — Ctrl+C)")
    if not s.cookie_secure and s.host not in ("127.0.0.1", "localhost"):
        print("ВНИМАНИЕ: COOKIE_SECURE не включён. В интернете сайт должен работать только по HTTPS!")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер остановлен.")


if __name__ == "__main__":
    main()
