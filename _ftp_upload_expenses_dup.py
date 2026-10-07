from ftplib import FTP
from pathlib import Path

ROOT = Path(r"D:\Users\toph\Documents\tophoftheworld.github.io")
CREDS = ROOT / "ftp-credentials.txt"

FILES = [
    "expenses/admin.html",
    "expenses/index.html",
    "expenses/css/admin.css",
    "expenses/css/style.css",
    "expenses/js/shared.js",
    "expenses/js/admin.js",
    "expenses/js/admin-batch.js",
    "expenses/js/script.js",
]


def read_creds():
    data = {}
    for line in CREDS.read_text(encoding="utf-8").splitlines():
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        data[key.strip().lower()] = val.strip()
    return data


def main():
    creds = read_creds()
    host = "162.0.235.16"
    user = creds["user"]
    password = creds["password"]
    base = (creds.get("path") or "/public_html").rstrip("/")

    ftp = FTP()
    ftp.connect(host, 21, timeout=60)
    ftp.login(user, password)
    ftp.set_pasv(True)
    print(f"Connected to {host} as {user}")

    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            print(f"SKIP missing {rel}")
            continue
        remote = f"{base}/{rel}"
        with local.open("rb") as f:
            ftp.storbinary(f"STOR {remote}", f)
        print(f"OK {rel} ({local.stat().st_size} bytes)")

    ftp.quit()
    print("Done")


if __name__ == "__main__":
    main()
