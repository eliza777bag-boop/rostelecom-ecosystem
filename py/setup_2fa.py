"""
setup_2fa.py — первоначальная настройка входа (запускается один раз на вашем компьютере).

    python backend/setup_2fa.py          — создать/обновить пользователя, сохранить в private/auth.json
    python backend/setup_2fa.py --env    — то же, но вместо файла показать строки для переменных
                                           окружения хостинга (Render и т.п.); файл не создаётся

Что делает:
  1. Спрашивает логин и пароль (пароль на экране не отображается).
  2. Считает хеш пароля (сам пароль нигде не сохраняется).
  3. Создаёт случайный секрет TOTP и показывает его — его нужно ввести
     в Google Authenticator / Microsoft Authenticator («Ввести ключ настройки»).
  4. Просит ввести 6-значный код из приложения, чтобы убедиться, что всё настроено верно.
  5. Только после верного кода сохраняет данные.
"""
import getpass
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import auth_core  # noqa: E402

ISSUER = "Экосистема РТ"


def ask_username():
    while True:
        name = input("Логин (латиница, цифры, точка, дефис, _): ").strip()
        if re.fullmatch(r"[A-Za-z0-9._-]{3,50}", name):
            return name
        print("  Логин должен быть от 3 до 50 символов: латинские буквы, цифры, . _ -")


def ask_password():
    while True:
        p1 = getpass.getpass(f"Пароль (не меньше {auth_core.MIN_PASSWORD_LENGTH} символов, "
                             "при вводе символы не видны): ")
        if len(p1) < auth_core.MIN_PASSWORD_LENGTH:
            print("  Слишком короткий пароль.")
            continue
        p2 = getpass.getpass("Повторите пароль: ")
        if p1 != p2:
            print("  Пароли не совпадают, попробуйте ещё раз.")
            continue
        return p1


def main():
    env_mode = "--env" in sys.argv
    print("=== Настройка двухфакторного входа ===\n")
    username = ask_username()
    password = ask_password()
    print("Считаю хеш пароля (пара секунд)…")
    pw_hash = auth_core.hash_password(password)
    secret = auth_core.new_totp_secret()
    grouped = " ".join(secret[i:i + 4] for i in range(0, len(secret), 4))

    print("\n--- Шаг 2. Добавьте аккаунт в приложение-аутентификатор ---")
    print("Google Authenticator: «+» → «Ввести ключ настройки».")
    print("Microsoft Authenticator: «+» → «Другая учётная запись» → «Ввести код вручную».")
    print(f"  Название аккаунта: {ISSUER} ({username})")
    print(f"  Ключ:              {grouped}")
    print("  Тип ключа:         По времени (Time based)")
    print("\n(Ссылка otpauth — для приложений, которые принимают её целиком:)")
    print("  " + auth_core.otpauth_uri(secret, username, ISSUER))
    print("\nНикому не показывайте этот ключ и не присылайте его в чатах.\n")

    for attempt in range(5):
        code = input("Введите 6-значный код из приложения: ").strip().replace(" ", "")
        if auth_core.totp_match(secret, code) is not None:
            break
        print("  Код не подошёл. Проверьте, что ключ введён без ошибок и время на телефоне "
              "и компьютере выставлено автоматически.")
    else:
        print("\nНастройка НЕ сохранена. Запустите скрипт заново.")
        sys.exit(1)

    if env_mode:
        print("\nКод верный. Добавьте на хостинге три секретные переменные окружения:\n")
        print(f"AUTH_USERNAME={username}")
        print(f"AUTH_PASSWORD_HASH={pw_hash}")
        print(f"AUTH_TOTP_SECRET={secret}")
        print("\nПосле копирования закройте это окно (очистите экран), чтобы секрет не остался на виду.")
    else:
        path = auth_core.save_user(username, pw_hash, secret)
        print(f"\nГотово! Данные сохранены в {path}")
        print("Этот файл секретный: не загружайте его в git и никому не отправляйте.")
        print("Теперь запустите сервер:  python backend/server.py")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\nОтменено.")
        sys.exit(1)
