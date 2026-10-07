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


FILES = [
    "expenses/admin.html",
    "expenses/index.html",
    "expenses/js/shared.js",
    "expenses/js/admin.js",
    "expenses/js/admin-batch.js",
    "expenses/js/script.js",
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


creds = read_creds()
ftp = FTP()
ftp.connect("162.0.235.16", 21, timeout=60)
ftp.login(creds["user"], creds["password"])
ftp.set_pasv(True)

base = (creds.get("path") or "/public_html").rstrip("/")
for rel in FILES:
    local = ROOT / rel
    remote = f"{base}/{rel}".replace("\\", "/")
    ensure_dirs(ftp, "/".join(remote.split("/")[:-1]))
    with local.open("rb") as f:
        ftp.storbinary(f"STOR {remote}", f)
    print(f"OK {rel} -> {remote}")

ftp.quit()
print("Done.")
