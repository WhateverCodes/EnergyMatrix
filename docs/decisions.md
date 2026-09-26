# Decisions log

- Repo root is `~/Desktop/hackathon` (not a `renewable-grid-digital-twin/` subfolder) — the brief says build "in the current directory" and the Kaggle data already lives at `data/raw/solar_kaggle/`.
- Python 3.11 from python.org framework build (`/Library/Frameworks/.../python3.11`) — only 3.10–3.12 interpreter present; Homebrew default is 3.14.
- Added 4 normally-closed sectionalizing switches (SW 3-8, SW 8-9, SW 10-11, SW 5-6) to CIGRE MV — with only ties S1–S3 the default is the only radial config, so reconfiguration would be trivial. 128 combos → 17 radial & connected.
- "Radial" = no cycle in the switch-respecting graph including the 110 kV bus, so closing a tie between feeder 1 and 2 without opening a section counts as meshed.
- Voltage limits are checked only on 20 kV buses; bus 0 is the 110 kV slack held at 1.03 pu.
- Loss % = total line+trafo losses / total load served; > loss_pct_max is a WARNING, not a hard constraint.
- Installed numba 0.67 (self-contained wheels, no OpenMP) to silence pandapower's slow-path warning.
- pandapower `recycle={"bus_pq": True}` used within a fixed topology (verified equal to fresh solve by test); rebuilt on any topology change.
- Frontend scaffolded with Vite 8 + Tailwind 4 (`@tailwindcss/vite`); React pinned to 18 as specified.
