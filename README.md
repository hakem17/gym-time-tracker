# Gym Time Tracker

Installable web app (PWA): rest timer, set logging, session summaries, and a dashboard (progress, body, food).

- `plan.js` — exercises and current targets (coach-managed; bump `PLAN_VER` on each update so phones pick up new targets).
- `app.js` — logging, timer, history, settings.
- `dash.js` — dashboard and charts.
- `data.enc.json` — coach data (InBody, waist, physique notes, nutrition, chat-era workouts), encrypted.
  `keys.json` holds the public key plus the private key wrapped with the owner's passphrase.
  Updating the data needs only the public key: `python3 tools/crypt.py encrypt keys.json data.json data.enc.json`.
  Never commit the plaintext `data.json`.
