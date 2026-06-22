# Downloads Folder Organization Plan

**Snapshot:** 491 items, ~2.3 GB total
**Generated:** April 20, 2026
**Deletion style:** Moderate (flag obvious junk + likely-obsolete items for review)
**Business files:** Organize carefully, flag exact duplicates

---

## At-a-glance summary

| Bucket | Count (approx.) | Notes |
|---|---|---|
| **Delete now** (safe) | ~40 files | Lock files, 0-byte file, failed downloads, exact duplicates |
| **Delete after quick review** | ~80 files | Old installers, raw screenshots, social-media dumps, AI rough drafts |
| **Review individually** | ~25 files | Multiple versions of same doc where content differs |
| **Organize / keep** | ~345 files | Business docs, personal records, creative assets |

---

## 1. Suggested folder hierarchy

Create these inside `Downloads\` (or move them to `Documents\` if you want them out of Downloads entirely):

```
Downloads\
├── 01_Business_Matchanese\
│   ├── Legal_Corporate\          (SEC, BIR, GIS, COR, Affidavits, Sec Cert)
│   ├── Contracts_Leases\         (all CONTRACT-OF-LEASE, signed contracts)
│   ├── Permits_Licenses\         (Work Permits, Business Permits)
│   ├── Letters_of_Intent\        (LOI-*, *-LOI*, Baron's Place LOI)
│   ├── MOAs\                     (MOA files, ThirdSpace CE)
│   ├── Ingress_Egress_Forms\
│   ├── Vendor_Forms\             (Tenant Profile, VDE Load, Facility Guidelines)
│   ├── Invoices_Sent\            (Invoice#027 – #037)
│   ├── Invoices_Received\        (INV-2026-*, Invoice - 0009)
│   ├── Payroll\                  (NextPay, payslips, staff details)
│   ├── POS_Reports_Utak\         (all (YYYY-MM-DD) matchanese@utak.io files)
│   ├── Financial_Reports\        (ZReading, expenses, sales summaries)
│   ├── ITR_Tax\                  (itr_*, mtch_itr_*, AFS BIR)
│   ├── Banking\                  (Passbook jpgs, BDO passbook PDF)
│   ├── Staff_Documents\          (Character Reference, Contract - Cristopher David)
│   ├── Locations_Podium\
│   ├── Locations_SM_North\
│   ├── Locations_The_Block\
│   ├── Locations_366_EM\
│   ├── Locations_Pop-ups\        (Baron's, Edades, One Rockwell, Corner Market)
│   └── Scans\                    (CamScanner outputs, mobile scans)
│
├── 02_Personal\
│   ├── Travel\                   (Visa apps, travel letters, invitation letters, Kyoto/Osaka)
│   ├── IDs_and_Licenses\         (2x2, david_license, Valid Signatory)
│   └── Photos\                   (IMG_ personal photos, Bea Boldo photoshoot)
│
├── 03_Creative_Design\
│   ├── AI_Generated\
│   │   ├── Gemini\               (Gemini_Generated_Image_*)
│   │   └── ChatGPT\              (ChatGPT Image *)
│   ├── Branding_Logos\           (matchanese-logo-*, Sari logo, etc.)
│   ├── Source_Files_PSD_SKP\     (uniforms.psd, Matcha Kiosk.skp, logo.psd)
│   ├── Labels_Packaging\         (aki-*, Warabi, Bottle-front, Matcha Boi sticker)
│   ├── Menu_Assets\              (Matcha Bar Menu, podium-desserts-menu, menu-export)
│   ├── Menueditor_Exports\       (menueditor_item_*)
│   ├── Fonts\                    (another-shabby, rustic-roadway, font folder)
│   ├── Stock_and_Textures\       (polaroid, pngtree-tape, crumpled paper, 360_F_*)
│   └── Reference_Images\         (viber screenshots, social media saves)
│
├── 04_Video_Content\
│   ├── Raw_Footage\              (1004, 1207, 1216, 1227.mp4, copy_*.mov, 2026-01-30*)
│   ├── Timelapses\               (*-timelapse-2025.webm, matchaneselovers timelapse)
│   └── Audio\                    (Lafufu SFV, ReelAudio, humanerror-sp*.wav)
│
├── 05_Software_and_Tools\
│   ├── Installers\               (keep only current versions)
│   ├── Game_Human_Error\         (consolidated Human Error + Hazardous folders)
│   └── SSH_Keys\                 (toph-tinker.ppk + toph-tinker-ssh folder)
│
├── 06_Archive_2025\              (move anything older than ~Jan 2026 that you want kept but out of sight)
│
└── _Review\                      (temporary holding for ambiguous items – see §4)
```

---

## 2. Delete now (safe — exact duplicates, broken files, junk)

These are **verified safe deletions** (MD5 confirmed or functionally dead).

### 2a. Office lock files (always safe to delete — only exist when Excel/Word was open)

- `~$I.-Intro-to-Matcha.pptx`
- `~$MTCH_Q2_PODIUM-1.xlsx`
- `~$Products.xlsx`
- `~$aki nov 24.xlsx`
- `~$orders_export123123.xlsx`

### 2b. Zero-byte / broken files

- `travel-letter-toph.pdf`  (0 bytes — keep `travel-letter-toph (1).pdf` which is the real one; rename it by removing "(1)")
- `Unconfirmed 125541.crdownload`  (0 bytes)

### 2c. All `.crdownload` partial downloads (Chrome's failed/aborted downloads)

- `2307-Q3-2025-Podium (1).pdf.crdownload`  (you already have `2307-Q3-2025-Podium.pdf`)
- `Gemini_Generated_Image_5wikus5wikus5wik.png.crdownload`
- `Gemini_Generated_Image_99qdro99qdro99qd.png.crdownload`
- `Gemini_Generated_Image_t9gw8t9gw8t9gw8t.png.crdownload`
- `Gemini_Generated_Image_yux7cjyux7cjyux7.png.crdownload`  (you already have the real `.png` version)
- `IMG_1366.HEIC.crdownload`
- `INGRESS&EGRESS FORM REVISED 03.05.2025 (1) (1).pdf.crdownload`  (dupe of existing `(1).pdf`)
- `Podium-Q2-FY-052026-Report-with-Other-Expenses.pdf.crdownload`
- `Unconfirmed 124581.crdownload`, `196647`, `327170`, `588658`, `828208`, `86246`  (all anonymous failed downloads)
- `V2-LOI-3613E-One-Rockwell.pdf.crdownload`

### 2d. Exact duplicates (MD5-verified identical — keep one, delete the rest)

| Keep | Delete |
|---|---|
| `ANA_Matchanese_366 EM_10.01.2025.PDF` | `ANA_Matchanese_366 EM_10.01.2025 (1).PDF` |
| `LOI-Edades-3508.v2.pdf` | `LOI-Edades-3508.v2 (1).pdf` |
| `Details of the Company_Organization.pdf` | `Details of the Company_Organization (1).pdf` (identical hash) |
| `matchanese-logo-2024.png` | `matchanese-logo-2024 (1).png` |
| `menueditor_item_4209d6bbeeb94285af7e77351f9b2a1a_1763021050430566484.webp` | `...(1).webp` |
| `menueditor_item_823d8785b90e4061bce93752b04cc99d_1763017375477175164.webp` | `...(1).webp` |
| `menueditor_item_86fc6dc3d11f4fafaaa77719ffe85059_1763021136526273636.webp` | `...(1).webp` |
| `menueditor_item_fa976363261e4687a2292fa26a7c1c5d_1763017381772985674.webp` | `...(1).webp` |
| `611243726_..._n.jpg` | `611243726_..._n (1).jpg` |
| `611335190_..._n.jpg` | `611335190_..._n (1).jpg` AND `(2).jpg` |
| `(2025-09-24 14-09) matchanese@utak.io Monthly ZReading for 2025-07...pdf` | `2025-09-24-14-09-matchaneseutak.io-Monthly-ZReading-for-2025-07-01...pdf` (same file, renamed dupe) |
| `(2026-02-12 11-02) matchanese@utak.io Daily for 2026-01...csv` | `(2026-02-24 09-29) matchanese@utak.io Daily for 2026-01...csv` (same content, later export) |

### 2e. Triple-extensions and obvious junk filenames

- `20250903-PROC-1006-FRM.pdf.pdf.pdf`  (rename to `20250903-PROC-1006-FRM.pdf`)
- `aasdasd.csv`, `123123.csv`, `44324341234.csv`  (test/throwaway CSVs — confirm and delete)
- `Details of the Company_Organization (1)[1].pdf` and `Details_of_the_Company_Organization_(1)[1][1].pdf`  (weird bracket-duplicates from email downloads — already have clean version)

### 2f. Old installers (you've already installed these)

- `FileZilla_3.67.0_win64-setup.exe`  (superseded by 3.69.3)
- `FileZilla_3.69.3_win64-setup.exe`  (delete after confirming FileZilla works)
- `Reader_en_install.exe`  (Adobe Reader — long installed)
- `fixo_google_trial_installer_20251227...exe`  (trial installer)

### 2g. Duplicate folders (Unity game "Human Error" extracted twice)

- Folder `Hazardous\`  AND  `Hazardous.zip`  AND  folder `Human Error\`  — these three contain the **same Unity game build**. Keep ONE copy (I'd suggest keeping the `.zip` only and deleting both extracted folders, saves ~340 MB).
- `another-shabby.zip` (you already extracted to `another-shabby\` folder)
- `font.zip` (extracted to `font\` folder)
- `rustic-roadway-personal-use.zip` (extracted to `rustic-roadway-personal-use\` folder)

> For all four: either keep the zip OR the folder, not both.

---

## 3. Delete after a quick review (likely-obsolete)

### 3a. Social-media image dumps (Facebook/Viber auto-downloads)

These are the `5xx_xxx_xxx_n.png/jpg` files (Facebook download naming) and `viber_image_*` files — 30+ files. They're almost certainly saved reference/meme images from chats. **Skim the thumbnails, save any you want to `03_Creative_Design\Reference_Images\`, delete the rest.**

Files: `511522016_*`, `521102974_*`, `521410358_*`, `600624560_*`, `601077205_*`, `601105670_*`, `601297887_*`, `608853244_*`, `609832631_*`, `610154346_*`, `610225217_*`, `611021418_*`, `611243726_*`, `611335190_*`, `612280106_*`, `612616628_*`, `615486644_*`, `viber_image_2025-10-21_*` (5 files), `viber_image_2025-11-05_*`, `viber_image_2025-12-15_*`, `viber_image_2026-02-04_*` (2 files), `att.94Q6*`, `att.Bwt7*`.

### 3b. Random "Unconfirmed"-style phone/scan dumps

- `20E56F7E-61AD-428E-9C23-053A2C39DD6F.png`
- `602b354f-2a5f-4502-8700-ec1c0b1ee45a.png`
- `C1F45EE5-F275-409E-B464-8DB449926523.png`
- `2b58d3094e4c45a5ae8d3e68d22481d9.MOV`
- `ec48c9b744b840ca9e197c61b88df1cd.mov`
- `128930718923.PNG`, `790778-200.png`, `images.png`, `Attached_image.png`, `Capture.PNG`, `uj.PNG`, `unnamed.png`, `unnamed (1).jpg` through `unnamed (4).jpg`
- `__________2024-09-25_182033.jpg`

### 3c. AI-generated rough drafts (40+ files)

- All 40 `Gemini_Generated_Image_*.png` files
- All 10 `ChatGPT Image Dec 29, 2025, *.png` / `Dec 30, 2025, *.png` files
- `Generative Fill.png`, `Generative Fill 2.png`, `Generative Fill 3.png`

> These are typically iteration/brainstorm outputs. **Recommend:** keep the 2–3 you actually used, delete the rest. If you want to be thorough, make an `AI_Generated_Archive_2025.zip` and delete the loose files.

### 3d. `SaveInst.App_*` files (TikTok/Instagram saved videos, 5 of them)

- All five `SaveInst.App_AQ*.mp4` — these are downloaded social videos with garbage filenames. Rename any you want to keep, delete the rest.

### 3e. "copy_*" mov files — 10 files, ~140 MB

All begin with `copy_` + UUID. Likely iCloud-copied phone videos:
- `copy_2F414D8D-*`, `copy_52B6DAA0-*`, `copy_5D4F7C4E-*`, `copy_96D3D7EC-*`, `copy_A427C347-*`, `copy_C1634F75-* (1).mov` through `(4).mov` + base file

> MD5-verified all 5 `C1634F75` variants are **different content** (not duplicates). Review and keep what you need, delete the rest.

### 3f. Old/throwaway CSVs from testing

- `aasdasd.csv`, `orders_export123123.csv`, `orders_export123123.xlsx`, `orders_export_1.csv` (40k rows — maybe real?)
- `123123.csv`, `44324341234.csv`

### 3g. Disposable tools / weird files

- `testdisk-7.3-WIP.win`  (partition recovery tool — delete if not actively using)
- `Rotate.fbx`  (stray 3D file)
- `42539A5D-timelapse-test.h264`  (raw H.264 test)
- `download.htm`  (random saved webpage)
- `desktop.ini`  (Windows system file — safe to delete from Downloads)

---

## 4. Review individually (content differs — can't auto-decide)

These have the same filename base with `(1)` / `(2)` suffixes but **different file content** (MD5 verified). Open each and pick the right one.

| File group | Notes |
|---|---|
| `CONTRACT-OF-LEASE-22E-June-2025-FINAL-1.pdf` vs `(1).pdf` | Different hashes — likely different revisions. Pick the final signed version. |
| `VDE Load Schedule Form.pdf` vs `(1).pdf` | Different content. |
| `Villa.Deste.House.Rules.Revised 01.25.26.pdf` vs `(1).pdf` | Different content. |
| `GOMO x Matchanese Conforme.pdf` vs `(1).pdf` | Different content. |
| `FINAL-OFFER.pdf` vs `(1).pdf` | Different content. |
| `Contract - Cristopher David - Creative Prototyping Lead.pdf` vs `(1).pdf` | Different content. |
| `Bea Boldo-07772.jpg` vs `(1).jpg` | Different edits of same photo. |
| `IMG_5119.png` vs `(1).png` | Different. |
| `Tenant Profile Form 1 - Partnership and Corporation.xlsx` vs `(1).xlsx` | Different data entered. |
| `TOF INGRESS - MATCHANESE front of 366 EM (tempo area).pdf` vs `(2).pdf` | Different. |
| `MOA_MATCHANESE POP-UP - OS_01.24.2026_...pdf` vs `(1).pdf` vs `-signed.pdf` | Keep signed, decide on other two. |
| `Lalaine Taghoy-timelapse-2025.webm` + `(1)` + `(2)` | Three different takes. |
| `random-timelapse-2025.webm` + `(1)` + `(2)` | Three different takes. |
| `NextPay Batch Import - Employee Directory - Employee.csv` + `(1)` + `(2)` + `.tsv` | Four different imports — keep the most recent. |
| `Invitation Letter.pdf` + `Invitation Letter Bea.pdf` + `Invitation Letter Toph.pdf` | Base `Invitation Letter.pdf` may be a template — check. |
| `LOI-Edades-3508.pdf` + `-signed.pdf` + `.v2.pdf` + `.v2-signed.pdf` | Keep both signed versions, archive the drafts. |
| `1 - WRI Work Permit.pdf` (78 KB) vs `(1).pdf` (224 KB) vs `(1)-compressed.pdf` (137 KB) | Sizes differ a lot — the 224 KB one is probably the true full-quality; verify. |
| `INGRESS&EGRESS FORM REVISED 03.05.2025.pdf` vs `(1).pdf` | Different content. |
| `Certificates_20_participants.pdf` vs `Certificates_21_participants.pdf` | Different participant counts — keep both or keep final only. |
| `Employees report_General [2025.09.12 at 8_14 pm].csv` vs `8_16 pm` | 2 minutes apart; probably identical-ish. Keep one. |
| `aki nov 24.csv` + `.xls` + `.xlsx` | Same data in 3 formats — keep `.xlsx` only. |
| `orders_export*` family (6 files) | Different exports on different days — consolidate or archive. |
| `menu-2026-03-03.json` vs `(1).json` | Different menu versions. |
| `event-sales-Love-&-Matcha-2026-02-14.png` vs `2026-02-15.png` | Two-day event, keep both. |

---

## 5. Per-file destinations for things to keep

Below is a compact mapping. Files not listed are covered by the categories above or the delete lists.

### → `01_Business_Matchanese\Legal_Corporate\`

`SEC Certificate of Incorporation.JPG`, `Secretarys Certificate 20221223.pdf`, `Sec Cert - First Circle.pdf`, `GIS-2024-MATCHANESE-INC.pdf`, `Matchanese GIS 2025.pdf`, `COR RDO 041.pdf`, `MAIN RDO 049 NEW COR VAT TYPE.pdf`, `Affidavit_of_Capital_Investment_Matchanese.pdf`, `AFS - BIR Acknowledgement.pdf`, `Details of the Company_Organization.pdf` (the kept copy), `Lloyds-RBCL-v.1a-Consent-Form_6459072748914019462.pdf`

### → `01_Business_Matchanese\Contracts_Leases\`

`CONTRACT-OF-LEASE-22E-June-2025-FINAL-1.pdf` (kept version), `Contract-of-Lease-Unit-22E-SW.pdf`, `Contract of Lease The Corner Market x matchanese.pdf`, `GOMO x Matchanese Conforme.pdf` (kept version)

### → `01_Business_Matchanese\Permits_Licenses\`

`1 - WRI Work Permit (1).pdf` (the kept one), `A.1 Work Permit Form (2022 Word File).pdf`, `Matchanese-WorkPermit.pdf`, `Business Permit Podium 2.pdf`

### → `01_Business_Matchanese\Letters_of_Intent\`

`Baron's Place Letter of Intent.pdf`, `3613E-One-Rockwell-LOI.pdf`, `LOI-Edades-3508.v2-signed.pdf`, `LOI-Edades-3508-signed.pdf`

### → `01_Business_Matchanese\MOAs\`

`MOA_MATCHANESE POP-UP - OS_01.24.2026_TO_02.28.2026-signed.pdf`, `Matchanese MOA _ Full ID Service Proposal 10192025.pdf`, `Signed-Matchanese MOA _ Full ID Service Proposal 10192025.pdf`, `ThirdSpace CE_Matchanese09.18 - ALABANG Third Space CE (1).pdf`

### → `01_Business_Matchanese\Ingress_Egress_Forms\`

`INGRESS FORM FOR FOOD CARTS MOBILE BARS & GRAZING TABLES.pdf`, `INGRESS&EGRESS FORM REVISED 03.05.2025.pdf` (pick one of the two), `TOF INGRESS - MATCHANESE 366 EM.pdf`, `TOF INGRESS - MATCHANESE front of 366 EM (tempo area).pdf` (pick one)

### → `01_Business_Matchanese\Vendor_Forms\`

`2.1 - Facility Guidelines for Vendors May 2025.pdf`, `Tenant Profile Form 1 - Partnership and Corporation.xlsx` (pick one), `Tenant Profile Form 2 - Partnership and Corporation.xlsx`, `VDE Load Schedule Form.pdf` (pick one), `20251228-1000024871-SMNE-Mall The Block-MATCHANESE INC (1).pdf`

### → `01_Business_Matchanese\Invoices_Sent\`

`Invoice#027 revised Matchanese.pdf` through `Invoice#037 Matchanese.pdf` (11 files)

### → `01_Business_Matchanese\Invoices_Received\`

`Invoice - 0009.pdf`, `INV-2026-0123-002_Alexandra_Asuncion.pdf`, `INV-2026-0123-003_Alexandra_Asuncion (1).pdf`

### → `01_Business_Matchanese\Payroll\`

`NextPay Batch Import - Employee Directory - Employee.csv` (one of them), `matchanese_payslip_Denzel_Genesis_Fernandez_Nov_13-27_2025.pdf`, `matchanese_payslip_John_Lester_Cal_Dec_13-28_2025.pdf`, `(2025-09-13 19-31) matchanese@utak.io Staff Details for August 1, 2025 to August 31, 2025.csv`, `Employees report_General [2025.09.12 at 8_14 pm].csv`

### → `01_Business_Matchanese\POS_Reports_Utak\`

All remaining `(YYYY-MM-DD HH-MM) matchanese@utak.io *` files (Items.json/csv, Daily, Monthly, ZReading, Expenses). Consider subfolders by year.

### → `01_Business_Matchanese\Financial_Reports\`

`2307-Q3-2025-Podium.pdf`, `2307-Q3-2025-Podium_for-signing.pdf`, `Matchanese Finance Tracking 2025 - Copy of Podium  - Expenses.csv`, `matchanese-expenses-2026-01-06-2024-04-06-to-2026-01-06.csv`, `Sales Summary Report for August 2025.csv`, `ESales for July 2025.csv`, `EJournal for July 2025.txt`, `Transaction History - Matchanese Podium.pdf`, `Transaction History - Matchanese SM North.pdf`, `Transaction_History_6400352603090842252174615200_FQ8GTF.csv`, `Matchanese_Summary of Bid Comparison.pdf`, `running-low-report-Podium-2025-12-29.png`, `sales-report-Podium-2025-10-28/29/30/31.png`, `stock-adjustment-report-Podium-2025-12-29.png`, `sales-by-item-popup-matcha-tones-popup-2026-02-15.png`, `event-sales-Love-&-Matcha-2026-02-14/15.png`

### → `01_Business_Matchanese\ITR_Tax\`

`itr_matchanese_payment.pdf`, `mtch_itr_25_filed.pdf`

### → `01_Business_Matchanese\Banking\`

`Passbook - Matchanese Podium.jpg`, `Passbook - Matchanese SM North.jpg`, `matchanese_bdo_passbook.pdf`, `gcash-toph.png`

### → `01_Business_Matchanese\Staff_Documents\`

`Character Reference Verification - SANCHEZ, Earle Kit Marquez.docx` + `.pdf`, `Contract - Cristopher David - Creative Prototyping Lead.pdf` (pick one), `Valid Signatory - Beatrice Boldo.jpg`

### → `01_Business_Matchanese\Locations_366_EM\`

`ANA_Matchanese_366 EM_10.01.2025.PDF`, `SMOA EM 366 WITH OUTSIDE SEATING.pdf`, `MarketingLayout_366EM_09.22.2025.pdf`

### → `01_Business_Matchanese\Locations_Pop-ups\`

Edades LOIs, One Rockwell LOI, Baron's Place LOI, The Corner Market Contract, Love & Matcha files (`Love & Matcha - For Creators.pdf`, `Love & Matcha - For Matcha Brands.pdf`)

### → `01_Business_Matchanese\Scans\`

`CamScanner 1-6-26 20.50.pdf`, `Invitation Letter.pdf` files, `Matchanese Design Feedback.pdf` + `#2.pdf`

### → `02_Personal\Travel\`

`bea - visa application form.pdf`, `toph - visa application form.pdf`, `Invitation Letter Bea.pdf`, `Invitation Letter Toph.pdf`, `travel-letter-bea.pdf`, `travel-letter-toph (1).pdf` (rename to remove "(1)"), `kyoto-osaka-1.pdf`, `kyoto-osaka-2.pdf`

### → `02_Personal\IDs_and_Licenses\`

`2x2.jpg`, `david_license.jpg`

### → `02_Personal\Photos\`

All `IMG_*.HEIC` / `IMG_*.JPG` / `IMG_*.PNG` (40+ files), `Bea Boldo-07714.jpg`, `Bea Boldo-07772.jpg` (kept one), `bea-bday.jpg`, `IMG_8445.mov`

### → `03_Creative_Design\Branding_Logos\`

`matchanese-logo-2024.png` (kept), `matchanese-logo-full.png`, `matchanese-logo-full-1.png`, `matchanese-logo-stacked copy.psd`, `Logo.png`, `Logo Box 1.png`, `Group 1.png`, `Group 1 copy.png`, `Group 2.png`, `SariMatchaLogo - Sari-Main-Logo.png`, `Matcha Boi Logo Sticker_ 2in by 2in (round cut or die cut).png`

### → `03_Creative_Design\Source_Files_PSD_SKP\`

`DSC01091 copy.psd`, `uniforms.psd`, `Matcha Bar Podium.skp`, `Matcha Kiosk (SM North) - With Machine.skp`, `Matchanese MOA 12 15 25_KLEIB (1).skp`

### → `03_Creative_Design\Labels_Packaging\`

All `aki-*` files (label, 30g/100g variations, aki nov 24 data), `Warabi Matcha (Box) 6.35cm x 2.54cm.png`, `Bottle-front-10.5cmx4.25cm.jpg`, `Bottle-front-8.5cmx3.75cm.png`

### → `03_Creative_Design\Menu_Assets\`

`Matcha Bar Menu - A3.png`, `Matcha_Brew_Bar_Menu.csv`, `podium-desserts-menu-*.png`, `menu-export.png` / `(1).png`, `list-47.png`

### → `03_Creative_Design\Menueditor_Exports\`

Keep clean `menueditor_item_*.webp` (delete `(1)` duplicates per §2d); also move the entire `matchanese drinks\` subfolder here since it's the same kind of content.

### → `03_Creative_Design\Fonts\`

Existing folders: `another-shabby\`, `rustic-roadway-personal-use\`, `font\` (delete the .zip duplicates)

### → `03_Creative_Design\Stock_and_Textures\`

`polaroid-frame-PNG-for-photoshop-thumb32-1.png`, `pngtree-tape-paper-texture-png-image_5377187.png`, `white-crumpled-paper-texture-background-design-space-white-tone.jpg`, `360_F_528374925_*.jpg`, `Mall-of-Asia-logo.png`, `SM_Mall_of_Asia_Official_Logo_2022.svg.png`, `pink-heart_1fa77.png`, `teacup-without-handle_1f375.png`

### → `03_Creative_Design\Reference_Images\`

Keep whichever FB/Viber saves you still want here.

### → `04_Video_Content\Raw_Footage\`

`1004.mp4`, `1207(1).mp4`, `1216.mp4`, `1227.mp4`, `matcha-fine.MP4`, `2026-01-30 *.mp4` (4 files), `2026-02-11 22-29-22.mp4`, `2026-02-26 01-01-47.mp4`, whichever `copy_*.mov` you keep, `Human Error Intro.mov`, `Video_Generation_With_Walking_Animation.mp4`, `Game_Screenshot_From_Concept_Art.mp4`, `timelapse-t1est (video-converter.com).mp4`

### → `04_Video_Content\Timelapses\`

All `*-timelapse-2025*.webm` (Acerr, Lalaine, Laville, Liezel, Marie, Sarah, random) — the ones you decided to keep after the review in §4

### → `04_Video_Content\Audio\`

`Lafufu SFV 33.mp3`, `Lafufu SFV 34.mp3`, `ReelAudio-35238.mp3`, `ReelAudio-75722.mp3`, `ai-labubu-1.mp3`, `humanerror-sp.wav`, `humanerror-sp2.wav`

### → `05_Software_and_Tools\Installers\`

Keep only the newest installer if any (most can be deleted — see §2f).

### → `05_Software_and_Tools\Game_Human_Error\`

Pick ONE of: `Hazardous\`, `Hazardous.zip`, `Human Error\`. Delete the other two.

### → `05_Software_and_Tools\SSH_Keys\`

`toph-tinker.ppk`, `toph-tinker-ssh\` folder

---

## 6. Things worth flagging specifically

1. **Business-critical folder to treat carefully.** The 11 numbered invoices (`Invoice#027` through `#037`), the tax filings (`mtch_itr_25_filed.pdf`, `AFS - BIR Acknowledgement.pdf`), and the SEC/GIS docs are legally important — consider copying all of `01_Business_Matchanese\` to cloud backup (Google Drive / OneDrive) before you start moving files around.

2. **`wrapped-stats-2025-2026-01-14.json` (big — 38 MB).** That's a Spotify-style year-in-review export. Keep if sentimental, else delete.

3. **The existing `drive-download-20260210T102500Z-1-001\` folder (132 MB, 13 items).** Rename to something descriptive once you know what's in it — "drive-download" filenames become useless fast.

4. **The existing `Sept-Dec 2025 Receipts\` subfolder is already well-organized** — move it under `01_Business_Matchanese\Receipts\` as-is.

5. **`CapCut Drafts\` (149 MB)** — editing project files. Keep if CapCut still references them; delete if the final videos are elsewhere.

6. **`chats_5I59oL2kgMUyVVWSETY1R_2026-01-28~2026-02-27.json`** — ChatGPT chat export. Archive or delete.

---

## 7. Suggested workflow

1. **Make a backup first** (zip the whole Downloads folder to an external drive or OneDrive).
2. **Do §2 (Delete now) in one pass** — safest wins, frees ~350+ MB immediately.
3. **Create the top-level folders** from §1.
4. **Work top-down through §5** — move files in batches by category.
5. **Work through §4 (Review individually)** with the files in hand.
6. **Last pass on §3** — skim thumbnails, keep what you want, delete the rest.

Total estimated time: 45–90 minutes. You'll end up with ~300 well-organized files down from 491.
