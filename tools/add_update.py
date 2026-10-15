"""Add one coach update without the passphrase.
Usage: python3 tools/add_update.py <patch.json> "<short label>"
patch.json may contain any of: workouts, inbody, waist, weight, physique, nutrition.days, baselines.
It is encrypted with the public key in keys.json, saved as updates/<stamp>.enc.json and listed in updates/index.json.
The app merges every update on top of data.enc.json (same date = the newer update wins)."""
import sys, os, json, datetime, subprocess
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src, label = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "")
json.load(open(src))  # validate
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
os.makedirs(os.path.join(root, "updates"), exist_ok=True)
out = os.path.join(root, "updates", f"{stamp}.enc.json")
subprocess.run([sys.executable, os.path.join(root, "tools", "crypt.py"), "encrypt", os.path.join(root, "keys.json"), src, out], check=True)
idx_path = os.path.join(root, "updates", "index.json")
idx = json.load(open(idx_path)) if os.path.exists(idx_path) else []
idx.append({"file": f"{stamp}.enc.json", "label": label, "at": stamp})
json.dump(idx, open(idx_path, "w"), ensure_ascii=False, indent=1)
print("added", out)
