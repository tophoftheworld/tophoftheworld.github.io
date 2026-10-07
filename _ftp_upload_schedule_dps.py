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


# Events widget system + Schedule deep-link (wave 1)
FILES = [
    "admin.html",
    "index.html",
    "events/admin.html",
    "events/css/events.css",
    "events/js/app.js",
    "events/js/panel.js",
    "events/js/sync.js",
    "events/js/types.js",
    "events/js/calendar.js",
    "events/js/leads-overlay.js",
    "events/js/invoices-overlay.js",
    "events/js/event-modal.js",
    "events/js/widgets/index.js",
    "events/js/widgets/registry.js",
    "events/js/widgets/schedule.js",
    "events/js/widgets/mocks.js",
    "schedule/js/script.js",
    "schedule/js/event-window.js",
    "schedule/index.html",
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
        remote = f"{base}/{rel.replace(chr(92), '/')}"
        ensure_dirs(ftp, remote.rsplit("/", 1)[0])
        with local.open("rb") as f:
            ftp.storbinary(f"STOR {remote}", f)
        print(f"OK {rel}")

    ftp.quit()
    print("Done")


if __name__ == "__main__":
    main()
