# Datasets

## Kaggle "Solar Power Generation Data" (REAL)

Two plants in India, 15 May – 17 Jun 2020, 15-min. Files: `Plant_{1,2}_Generation_Data.csv`, `Plant_{1,2}_Weather_Sensor_Data.csv` in `data/raw/solar_kaggle/` (gitignored).

Inspected facts and handling (`backend/app/datasets/solar_kaggle.py`):

| Issue | Finding | Handling |
|---|---|---|
| Date formats | Plant 1 generation uses `DD-MM-YYYY HH:MM`; the other three files use `YYYY-MM-DD HH:MM:SS` | Per-file format detection; naive local time (IST) |
| DC vs AC | Plant 1 DC_POWER ≈ 10.2 × AC_POWER (scale inconsistency); Plant 2 DC/AC ≈ 1.02 | AC_POWER used |
| Inverters | 22 SOURCE_KEYs per plant; some timestamps have fewer rows (Plant 1: 101 steps; Plant 2: 904 steps, mostly 18 of 22) | Plant total = mean per reporting inverter × 22, flagged `missing_inverters` |
| Gaps | Plant 1 has 77 steps in long gaps | Gaps ≤ 1 h interpolated (`interpolated`); longer gaps → 0 if irradiation = 0 (`night_zero`), else `long_gap` (excluded from metrics; scenario windows containing them are rejected with `DATA_GAP`) |
| Capacity | — | 99.5th percentile of plant AC: Plant 1 ≈ 27.6 MW, Plant 2 ≈ 21.8 MW; `generation_pu` = AC / capacity, clipped to [0, 1] |
| Weather | One sensor per plant | IRRADIATION, AMBIENT_TEMPERATURE, MODULE_TEMPERATURE joined |

Normalised schema: `timestamp, dataset_id, location, source_type, generation_kw, generation_pu, irradiation, ambient_temp, module_temp, quality_flag`. The twin uses only the **shape** (pu), scaled to the feeder's installed PV. UI label: "Real plant generation shape (Kaggle, India) — scaled to feeder PV capacity".

Calibration picked **2020-05-25** as the clearest day and **2020-06-06** as the roughest (cloudiest).

## SYNTHETIC clear-sky fallback

A deterministic sin^1.5 bell (06:00–18:45) with seeded cloud dips, always registered with `is_real = false`. It is used as the default only if the Kaggle files are missing; the terminal then prints a warning telling the user where to place them.

## Synthetic consumer profiles

Bungalow, Residential Society, Neighborhood, Small Factory, School, Hospital, Commercial Building, Office. 24 hourly anchors interpolated to 15 min; P = (base + (peak − base)·shape) × scale × weekend factor. Optional seeded ±3 % noise. Background CIGRE loads: `Load R*` follow Residential Society, `Load CI*` follow Commercial Building, normalised to peak, at nominal CIGRE magnitudes. The selected consumer is **added** as a separate load at the target bus.

## CSV upload

`POST /api/datasets/upload` (multipart: file + timestamp_col, value_col, unit W/kW/MW, source_type solar/load, name, location). It validates columns, reports missing values, detected resolution, interpolated and long-gap steps, resamples to 15 min, writes a normalised CSV + `.meta.json` to `data/processed/`, and stores a row in SQLite. Uploads are labelled **UPLOADED · UNVERIFIED**.
