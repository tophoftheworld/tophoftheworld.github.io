"""
Quick upload to Google Drive from Explorer context menu.
See README.md for setup.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import zipfile
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

SCOPES_FILE = ["https://www.googleapis.com/auth/drive.file"]
SCOPES_FULL = ["https://www.googleapis.com/auth/drive"]


def app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent.resolve()
    return Path(__file__).resolve().parent


def data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    d = Path(base) / "QuickDriveUpload"
    d.mkdir(parents=True, exist_ok=True)
    return d


def token_path() -> Path:
    return data_dir() / "token.json"


def load_config() -> dict:
    cfg_path = app_dir() / "config.json"
    if not cfg_path.is_file():
        example = app_dir() / "config.example.json"
        raise SystemExit(
            f"Missing {cfg_path}. Copy config.example.json to config.json and edit it.\n"
            + (f"(Example is at {example})" if example.is_file() else "")
        )
    with cfg_path.open(encoding="utf-8") as f:
        return json.load(f)


def resolve_credentials_path(config: dict) -> Path:
    p = Path(config["credentials_path"])
    if not p.is_absolute():
        p = app_dir() / p
    if not p.is_file():
        raise SystemExit(f"OAuth credentials file not found: {p}")
    return p


def get_scopes(config: dict) -> list[str]:
    if config.get("use_full_drive_scope"):
        return list(SCOPES_FULL)
    return list(SCOPES_FILE)


def get_credentials(config: dict) -> Credentials:
    creds_file = resolve_credentials_path(config)
    scopes = get_scopes(config)
    tok = token_path()
    creds: Credentials | None = None
    if tok.is_file():
        creds = Credentials.from_authorized_user_file(str(tok), scopes)
    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            tok.write_text(creds.to_json(), encoding="utf-8")
        except Exception:
            creds = None
    if not creds:
        flow = InstalledAppFlow.from_client_secrets_file(str(creds_file), scopes)
        creds = flow.run_local_server(port=0, prompt="consent")
    tok.write_text(creds.to_json(), encoding="utf-8")
    return creds


def zip_directory(src: Path, dest_zip: Path) -> None:
    with zipfile.ZipFile(dest_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(src):
            root_path = Path(root)
            for name in files:
                fp = root_path / name
                try:
                    arcname = fp.relative_to(src)
                except ValueError:
                    continue
                zf.write(fp, arcname.as_posix())


def drive_file_link(file_id: str) -> str:
    return f"https://drive.google.com/file/d/{file_id}/view"


def upload_path(
    service,
    local_path: Path,
    parent_folder_id: str | None,
    share_anyone: bool,
) -> tuple[str, str]:
    """Returns (file_id, web_view_url)."""
    cleanup: Path | None = None
    try:
        if local_path.is_dir():
            stem = local_path.name
            fd, zip_name = tempfile.mkstemp(suffix=".zip", prefix=f"{stem}_")
            os.close(fd)
            cleanup = Path(zip_name)
            zip_directory(local_path, cleanup)
            upload_file = cleanup
            drive_name = f"{stem}.zip"
        else:
            upload_file = local_path
            drive_name = local_path.name

        body: dict = {"name": drive_name}
        if parent_folder_id:
            body["parents"] = [parent_folder_id]

        media = MediaFileUpload(str(upload_file), resumable=True)
        created = (
            service.files()
            .create(
                body=body,
                media_body=media,
                fields="id, webViewLink",
                supportsAllDrives=True,
            )
            .execute()
        )
        file_id = created["id"]
        if share_anyone:
            service.permissions().create(
                fileId=file_id,
                body={"type": "anyone", "role": "reader"},
                fields="id",
                supportsAllDrives=True,
            ).execute()
            meta = (
                service.files()
                .get(fileId=file_id, fields="webViewLink", supportsAllDrives=True)
                .execute()
            )
            url = meta.get("webViewLink") or drive_file_link(file_id)
        else:
            url = created.get("webViewLink") or drive_file_link(file_id)
        return file_id, url
    finally:
        if cleanup and cleanup.is_file():
            try:
                cleanup.unlink()
            except OSError:
                pass


def show_link_dialog(url: str, auto_copy: bool) -> None:
    import tkinter as tk
    from tkinter import ttk

    root = tk.Tk()
    root.title("Google Drive — share link")
    root.geometry("560x160")
    root.minsize(400, 120)

    frm = ttk.Frame(root, padding=12)
    frm.pack(fill=tk.BOTH, expand=True)

    ttk.Label(frm, text="Upload complete. Link:").pack(anchor=tk.W)
    entry = ttk.Entry(frm, width=72)
    entry.insert(0, url)
    entry.select_range(0, tk.END)
    entry.pack(fill=tk.X, pady=(4, 8))

    def copy_link() -> None:
        root.clipboard_clear()
        root.clipboard_append(url)
        root.update()

    def open_browser() -> None:
        import webbrowser

        webbrowser.open(url)

    btn_row = ttk.Frame(frm)
    btn_row.pack(fill=tk.X)
    ttk.Button(btn_row, text="Copy", command=copy_link).pack(side=tk.LEFT, padx=(0, 8))
    ttk.Button(btn_row, text="Open in browser", command=open_browser).pack(
        side=tk.LEFT, padx=(0, 8)
    )
    ttk.Button(btn_row, text="Close", command=root.destroy).pack(side=tk.RIGHT)

    if auto_copy:
        copy_link()

    entry.focus_set()
    root.mainloop()


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload a file or folder to Google Drive.")
    parser.add_argument("path", type=Path, help="File or folder path (from Explorer %%1)")
    args = parser.parse_args()

    local = args.path.expanduser().resolve()
    if not local.exists():
        print(f"Not found: {local}", file=sys.stderr)
        return 1

    try:
        config = load_config()
    except SystemExit as e:
        print(str(e), file=sys.stderr)
        return 1

    parent = (config.get("parent_folder_id") or "").strip() or None
    share = bool(config.get("share_anyone_with_link", True))
    auto_copy = bool(config.get("auto_copy_link", True))

    try:
        creds = get_credentials(config)
    except Exception as e:
        print(f"Authentication failed: {e}", file=sys.stderr)
        return 1

    service = build("drive", "v3", credentials=creds, cache_discovery=False)

    try:
        _, url = upload_path(service, local, parent, share)
    except HttpError as e:
        msg = getattr(e, "error_details", None) or str(e)
        if e.resp.status == 403 and parent:
            print(
                "Permission denied uploading into the configured folder. "
                "Try setting use_full_drive_scope to true in config.json, "
                "or clear parent_folder_id to upload to My Drive root.\n"
                f"Details: {msg}",
                file=sys.stderr,
            )
        else:
            print(f"Drive API error: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Upload failed: {e}", file=sys.stderr)
        return 1

    show_link_dialog(url, auto_copy)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
