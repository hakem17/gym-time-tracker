"""Hybrid encryption compatible with WebCrypto.
keygen <passphrase> <out_keys.json>   -> RSA-OAEP-3072 keypair; private key wrapped with PBKDF2(SHA-256)+AES-GCM
encrypt <keys.json> <in.json> <out.enc.json> -> needs only the public key
decrypt <keys.json> <passphrase> <in.enc.json> -> test round trip"""
import sys, os, json, base64
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
b64 = lambda b: base64.b64encode(b).decode(); ub = base64.b64decode
ITER = 310000
OAEP = padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
def kdf(pw, salt): return PBKDF2HMAC(hashes.SHA256(), 32, salt, ITER).derive(pw.encode())
cmd = sys.argv[1]
if cmd == "keygen":
    pw, out = sys.argv[2], sys.argv[3]
    k = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    pkcs8 = k.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    spki = k.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(kdf(pw, salt)).encrypt(iv, pkcs8, None)
    json.dump({"v": 1, "alg": "RSA-OAEP-3072-SHA256", "pub": b64(spki),
               "priv": {"kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}}, open(out, "w"), indent=1)
elif cmd == "encrypt":
    keys, src, out = sys.argv[2:5]
    pub = serialization.load_der_public_key(ub(json.load(open(keys))["pub"]))
    key, iv = os.urandom(32), os.urandom(12)
    data = open(src, "rb").read()
    json.dump({"v": 1, "ek": b64(pub.encrypt(key, OAEP)), "iv": b64(iv), "ct": b64(AESGCM(key).encrypt(iv, data, None))}, open(out, "w"))
elif cmd == "decrypt":
    keys, pw, src = sys.argv[2:5]
    K = json.load(open(keys)); P = K["priv"]
    pkcs8 = AESGCM(kdf(pw, ub(P["salt"]))).decrypt(ub(P["iv"]), ub(P["ct"]), None)
    priv = serialization.load_der_private_key(pkcs8, None)
    E = json.load(open(src))
    key = priv.decrypt(ub(E["ek"]), OAEP)
    print(AESGCM(key).decrypt(ub(E["iv"]), ub(E["ct"]), None)[:120].decode(errors="replace"))
