"""
auth_core.py — «кирпичики» безопасности. Только стандартная библиотека Python.

  1. Пароли: хранится не сам пароль, а его хеш PBKDF2-HMAC-SHA256
     (600 000 итераций, случайная «соль» 16 байт). Восстановить пароль из хеша нельзя.
  2. TOTP (RFC 6238) — те же 6-значные коды, что показывают
     Google Authenticator / Microsoft Authenticator: SHA-1, 6 цифр, шаг 30 секунд.
  3. Чтение настроек входа: из переменных окружения (для хостинга)
     или из файла private/auth.json (для своего компьютера).
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import struct
import time
import urllib.parse

# ---------------------------------------------------------------- пароли
PBKDF2_ITERATIONS = 600_000  # рекомендация OWASP для PBKDF2-HMAC-SHA256
MIN_PASSWORD_LENGTH = 10


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str, iterations: int = PBKDF2_ITERATIONS) -> str:
    """Возвращает строку вида pbkdf2_sha256:600000:<соль>:<хеш>.
    Разделитель «:» выбран, чтобы строку было удобно класть в переменную окружения."""
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256:{iterations}:{_b64e(salt)}:{_b64e(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt, expected = stored.split(":")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), _b64d(salt), int(iters))
        return hmac.compare_digest(dk, _b64d(expected))  # сравнение за постоянное время
    except (ValueError, TypeError):
        return False


# Хеш-«пустышка»: проверяем его, если логина не существует, чтобы по времени ответа
# нельзя было понять, есть такой пользователь или нет.
_DUMMY_HASH = None


def dummy_verify(password: str) -> None:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password(secrets.token_hex(16))
    verify_password(password, _DUMMY_HASH)


# ---------------------------------------------------------------- TOTP
TOTP_DIGITS = 6
TOTP_PERIOD = 30
TOTP_WINDOW = 1  # принимаем код текущего шага ±1 шаг (±30 с) — на случай неточных часов
_CODE_RE = re.compile(r"^\d{6}$")


def new_totp_secret() -> str:
    """Случайный секрет 160 бит в Base32 — этот ключ вводится в приложение-аутентификатор."""
    return base64.b32encode(os.urandom(20)).decode("ascii").rstrip("=")


def _secret_bytes(secret_b32: str) -> bytes:
    s = secret_b32.strip().replace(" ", "").upper()
    return base64.b32decode(s + "=" * (-len(s) % 8))


def hotp(key: bytes, counter: int, digits: int = TOTP_DIGITS) -> str:
    """RFC 4226: одноразовый код по счётчику."""
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    number = struct.unpack(">I", mac[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(number % (10 ** digits)).zfill(digits)


def totp_now(secret_b32: str, at: float = None) -> str:
    at = time.time() if at is None else at
    return hotp(_secret_bytes(secret_b32), int(at // TOTP_PERIOD))


def totp_match(secret_b32: str, code: str, at: float = None, last_used_step: int = -1):
    """Проверяет код. Возвращает номер 30-секундного шага, если код верный, иначе None.
    Код с шагом <= last_used_step уже использовался — повторно не принимается."""
    code = (code or "").strip().replace(" ", "")
    if not _CODE_RE.match(code):
        return None
    at = time.time() if at is None else at
    key = _secret_bytes(secret_b32)
    current = int(at // TOTP_PERIOD)
    found = None
    for step in range(current - TOTP_WINDOW, current + TOTP_WINDOW + 1):
        if hmac.compare_digest(hotp(key, step), code) and step > last_used_step:
            found = step  # не выходим из цикла сразу — время проверки одинаковое
    return found


def otpauth_uri(secret_b32: str, username: str, issuer: str) -> str:
    label = urllib.parse.quote(f"{issuer}:{username}")
    query = urllib.parse.urlencode({"secret": secret_b32, "issuer": issuer,
                                    "algorithm": "SHA1", "digits": TOTP_DIGITS,
                                    "period": TOTP_PERIOD})
    return f"otpauth://totp/{label}?{query}"


# ---------------------------------------------------------------- настройки входа
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BACKEND_DIR)
DEFAULT_CONFIG_FILE = os.path.join(PROJECT_DIR, "private", "auth.json")


def config_path() -> str:
    return os.environ.get("AUTH_CONFIG_FILE") or DEFAULT_CONFIG_FILE


def load_users() -> dict:
    """{логин: {"password_hash": ..., "totp_secret": ...}}

    Порядок: 1) переменные окружения AUTH_USERNAME + AUTH_PASSWORD_HASH + AUTH_TOTP_SECRET
    (так делают на хостинге — секреты не лежат в файлах репозитория);
    2) файл private/auth.json, который создаёт setup_2fa.py."""
    u, h, s = (os.environ.get(k, "").strip() for k in
               ("AUTH_USERNAME", "AUTH_PASSWORD_HASH", "AUTH_TOTP_SECRET"))
    if u and h and s:
        return {u: {"password_hash": h, "totp_secret": s}}
    path = config_path()
    if not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("users", {})


def save_user(username: str, password_hash: str, totp_secret: str) -> str:
    path = config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = {"users": {}}
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    data.setdefault("users", {})[username] = {"password_hash": password_hash,
                                              "totp_secret": totp_secret}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)  # на Linux/macOS — читать может только владелец
    except OSError:
        pass
    return path
