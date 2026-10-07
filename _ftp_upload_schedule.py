from ftplib import FTP
from pathlib import Path

ROOT = Path(r"D:\Users\toph\Documents\tophoftheworld.github.io")
CREDS = ROOT / "ftp-credentials.txt"


def read_creds():
    data = {}
    for line in CREDS.read_text(encoding="utf-8").splitlines():
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        data[key.strip().lower()] = val.strip()
    return data


# Schedule app: venue under event headers, custom shift time defaults
FILES = [
    "schedule/index.html",
    "schedule/css/style.css",
    "schedule/js/script.js",
    "schedule/js/event-window.js",
    "admin-scheduling/index.html",
]


def ensure_dirs(ftp, remote_dir):
    parts = [p for p in remote_dir.strip("/").split("/") if p]
    path = ""
    for part in parts:
        path += "/" + part
        try:
            ftp.mkd(path)
        except Exception:
            pass


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
        local = ROOT / rel.replace("/", "\\")
        if not local.exists():
            print(f"SKIP missing {rel}")
            continue
        remote = f"{base}/{rel}"
        ensure_dirs(ftp, remote.rsplit("/", 1)[0])
        with local.open("rb") as f:
            ftp.storbinary(f"STOR {remote}", f)
        print(f"OK {rel}")

    ftp.quit()
    print("Done")


if __name__ == "__main__":
    main()
