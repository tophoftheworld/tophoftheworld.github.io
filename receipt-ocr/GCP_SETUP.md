# Google Cloud Vision setup (receipt OCR)

Follow these steps once per environment (dev laptop or cloud).

## 1. Create a project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or pick an existing one).
3. **Enable billing** on the project (Vision API is metered; new accounts may receive trial credit—check current Console messaging).

## 2. Enable Cloud Vision API

1. **APIs & Services → Library**.
2. Search for **Cloud Vision API** → **Enable**.

## 3. Create credentials (recommended: service account)

### Service account (for the Node server in `server/`)

1. **IAM & Admin → Service Accounts → Create service account** (name e.g. `vision-receipt-ocr`).
2. Grant role **Cloud Vision AI Service Agent** is not the right one—use **Vertex AI User** is wrong. For Vision API use:
   - **Service Account User** is not needed on the SA itself.
   - Attach role: **Cloud Vision** — the minimal role is often **Vertex AI User** for newer setups, but for classic Vision use **Owner** on a dev project or create a custom role with `visionai.images.annotate` / use **Cloud Vision API User** if available.
   - Simplest for a private tool: **Editor** on a small project (tighten later).

   **Minimal:** In **IAM**, add principal your service account with role **Cloud Vision AI Service Agent** — actually the correct minimal role for `images.annotate` is typically **Cloud Vision API User** (`roles/visionai.user`) if listed, or use **Basic → Editor** for internal tools.

3. **Keys → Add key → JSON** and download the file.
4. On the machine that runs the server, set:

   ```bash
   set GOOGLE_APPLICATION_CREDENTIALS=D:\path\to\service-account.json
   ```

   (Linux/macOS: `export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`)

5. Set `GOOGLE_CLOUD_PROJECT` to your **project ID** if the client library asks for it (optional when the JSON includes `project_id`).

### Never commit the JSON key

Add `*.json` keys to `.gitignore` in `server/` or keep keys outside the repo.

## 4. Run the proxy

See [server/README.md](server/README.md).

## 5. Quotas

Under **APIs & Services → Dashboard → Cloud Vision API**, review quotas and set alerts if needed.

## Data note

Receipt images are sent to Google for analysis. Use only if that meets your policy.
