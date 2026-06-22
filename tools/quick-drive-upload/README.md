# Quick Drive Upload (Windows)

Right-click any file or folder in Explorer, choose **Upload to Google Drive**, and get a copy-ready share link (optional “anyone with the link can view”).

## Prerequisites

- Windows 10 or 11
- [Python 3.10+](https://www.python.org/downloads/) (only if you run from source; not needed if you use a packaged `.exe`)
- A Google Cloud project with the Drive API and OAuth **Desktop** credentials

## Google Cloud setup (one time)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or pick a project.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen**  
   - User type: External (or Internal for Workspace-only).  
   - Add scopes: the app requests Drive scopes at runtime (`drive.file` or full `drive` — see [config](#configuration)).  
   - If the app stays in **Testing**, add your Google account under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**  
   - Application type: **Desktop app**.  
   - Download the JSON and save it as `credentials.json` in this folder (or set `credentials_path` in `config.json` to an absolute path).

## Install

```powershell
cd tools\quick-drive-upload
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy config.example.json config.json
# Edit config.json; place credentials.json here (or set credentials_path)
```

Register the context menu (current user only, no admin):

```powershell
.\install-context-menu.ps1
```

To point at a **PyInstaller** executable instead:

```powershell
.\install-context-menu.ps1 -CommandLine '"C:\Path\to\upload-to-drive.exe" "%1"'
```

### Remove the context menu

Delete these registry keys in `regedit` or PowerShell:

- `HKCU\Software\Classes\*\shell\QuickDriveUpload`
- `HKCU\Software\Classes\Directory\shell\QuickDriveUpload`

Example:

```powershell
Remove-Item -Recurse -Force "HKCU:\Software\Classes\*\shell\QuickDriveUpload"
Remove-Item -Recurse -Force "HKCU:\Software\Classes\Directory\shell\QuickDriveUpload"
```

## Configuration

Copy `config.example.json` to `config.json` next to `main.py` (or next to your packaged `.exe`).

| Field | Meaning |
|--------|--------|
| `credentials_path` | Path to the OAuth client JSON from Google. Relative paths are resolved from the folder containing `main.py` / the `.exe`. |
| `parent_folder_id` | Optional. ID of a Drive folder (from the URL `.../folders/THIS_PART`). Empty string uploads to My Drive root. |
| `share_anyone_with_link` | If `true`, adds a reader link for **anyone with the link**. |
| `auto_copy_link` | If `true`, copies the link to the clipboard when the result window opens. |
| `use_full_drive_scope` | If `true`, requests full `https://www.googleapis.com/auth/drive` (useful if uploads to a specific `parent_folder_id` fail with 403 under `drive.file`). **Use only on machines you trust** — do not distribute this lightly. |

### OAuth scopes

- Default: `https://www.googleapis.com/auth/drive.file` (minimal; files created by this app).
- If Google returns **403** when using `parent_folder_id`, set `use_full_drive_scope` to `true` or clear `parent_folder_id`.

## First sign-in

The first run opens a browser so you can sign in and consent. A refresh token is stored under:

`%LOCALAPPDATA%\QuickDriveUpload\token.json`

Do **not** commit `credentials.json`, `config.json` (if it contains secrets), or `token.json`. This directory’s `.gitignore` excludes local secrets.

## Behavior

- **File**: uploaded with its original name.
- **Folder**: zipped to a temporary `.zip`, then uploaded as `FolderName.zip` (single share link).

## Package as one `.exe` (optional)

From an activated venv with dependencies installed:

```powershell
pip install pyinstaller
pyinstaller --onefile --noconsole --name upload-to-drive main.py
```

Copy `config.example.json` → `config.json` and `credentials.json` next to `dist\upload-to-drive.exe`, then re-run `install-context-menu.ps1` with `-CommandLine` pointing at that exe.

## OAuth “Testing” mode

While the OAuth app is in **Testing**, refresh tokens can expire after extended disuse. Sign in again if uploads start failing with auth errors. Publishing the app for broader use requires Google’s verification for sensitive scopes.

## Troubleshooting

- **Missing config.json**: Copy from `config.example.json` and edit.
- **Python not found** from the installer script: install Python and ensure `py` or `python` is on `PATH`, or pass `-CommandLine` explicitly.
- **Tkinter missing** (rare on Windows): reinstall Python with the default “tcl/tk” option enabled.
