"""Upload changed POS app runtime files to FTP."""
from ftplib import FTP
from pathlib import Path

ROOT = Path(r"D:\Users\toph\Documents\tophoftheworld.github.io")
CREDS = ROOT / "ftp-credentials.txt"

# Runtime POS app files that differ locally (skip tests / setup helpers)
FILES = [
    "pos/index.html",
    "pos/dashboard.html",
    "pos/customer-display.html",
    "pos/queue-strip.html",
    "pos/sw.js",
    "pos/css/style.css",
    "pos/js/script.js",
    "pos/js/dashboard.js",
    "pos/js/firebase-sync.js",
    "pos/js/firebase-setup.js",
    "pos/js/customer-display.js",
    "pos/js/queue-strip.js",
    "pos/js/name-greeting-hook.js",
    "pos/js/event-window.js",
    "pos/js/order-sync-core.js",
]


def read_creds():
    data = {}
    for line in CREDS.read_text(encoding="utf-8").splitlines():
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        data[key.strip().lower()] = val.strip()
    return data


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
    host = creds.get("host") or "162.0.235.16"
    # Prefer hostname from creds; fall back to IP used by other scripts
    if host.startswith("ftp."):
        hosts = [host, "162.0.235.16"]
    else:
        hosts = [host]

    user = creds["user"]
    password = creds["password"]
    base = (creds.get("path") or "/public_html").rstrip("/")

    ftp = FTP()
    last_err = None
    for h in hosts:
        try:
            print(f"Connecting to {h}…")
            ftp.connect(h, 21, timeout=30)
            ftp.login(user, password)
            ftp.set_pasv(True)
            print(f"Connected as {user}")
            break
        except Exception as e:
            last_err = e
            print(f"Failed {h}: {e}")
            try:
                ftp.close()
            except Exception:
                pass
            ftp = FTP()
    else:
        raise SystemExit(f"Could not connect: {last_err}")

    for rel in FILES:
        local = ROOT / rel.replace("/", "\\")
        if not local.exists():
            print(f"SKIP missing {rel}")
            continue
        remote = f"{base}/{rel.replace(chr(92), '/')}"
        ensure_dirs(ftp, remote.rsplit("/", 1)[0])
        with local.open("rb") as f:
            ftp.storbinary(f"STOR {remote}", f)
        print(f"OK {rel} ({local.stat().st_size} bytes)")

    ftp.quit()
    print("Done")


if __name__ == "__main__":
    main()
