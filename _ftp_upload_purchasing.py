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
    "purchasing/admin.html",
    "purchasing/css/style.css",
    "purchasing/js/app.js",
    "purchasing/js/compute.js",
    "purchasing/js/store.js",
    "purchasing/js/ui/orders.js",
    "purchasing/js/ui/plan.js",
    "purchasing/js/ui/week-chrome.js",
    "purchasing/js/ui/spent.js",
    "purchasing/js/ui/shell.js",
    "purchasing/js/ui/past-weeks.js",
    "purchasing/js/ui/plan-line-modal.js",
    "purchasing/js/ui/location-chooser.js",
    "purchasing/js/ui/loading-shell.js",
    "purchasing/js/ui/budget-excel.js",
    "purchasing/js/data/custom-items.js",
    "purchasing/js/data/expense-link.js",
    "purchasing/js/data/item-prefs.js",
    "purchasing/js/data/last-route.js",
    "purchasing/js/data/order-feed.js",
    "purchasing/js/data/overlay-filter.js",
    "purchasing/js/data/plan-sync.js",
    "purchasing/js/data/popup-events.js",
    "purchasing/js/data/suppliers.js",
    "admin.html",
]
# Cache bumps touch every module's ?v= imports; ship them all so versions never mix.
FILES += sorted(
    p.relative_to(ROOT).as_posix()
    for p in (ROOT / "purchasing" / "js").rglob("*.js")
    if not p.name.endswith(".test.js")
)
FILES = list(dict.fromkeys(FILES))
# layout fix: week-chrome, plan, style + cache-bust dependents

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
