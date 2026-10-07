"""Rewrites devnet readback output for the secret scanner WITHOUT weakening it.

Base58 transaction signatures have the shape of base58 secret keys, so check:secrets flags them;
the repo keeps full signatures only in the hash-pinned receipts under docs/reviews/wallet-rewards/
(PINNED_EVIDENCE). Here each signature becomes signaturePrefix (first 12 chars) + signatureSha256
(sha256 of the full base58 string) + signatureSource (the pinned receipt that holds it in full).
Anyone can bind them back: sha256 each signature in the pinned receipt and compare.
Usage: python3 d-redact-signatures.py <raw.json> > <evidence.json>
"""
import hashlib, json, re, sys

SOURCES = {
    "receipt": "docs/reviews/wallet-rewards/devnet-pilot-receipt-run1.json (steps[].signature, refusals[].signature; pinned)",
    "threshold": "docs/reviews/wallet-rewards/devnet-pilot-run1-readback.json (pinned)",
    "completion": "docs/reviews/wallet-rewards/devnet-pilot-run1-completion.json send.signature (pinned)",
}
B58 = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{80,90}$")

def walk(x):
    if isinstance(x, dict):
        out = {}
        for k, v in x.items():
            if k == "signature" and isinstance(v, str) and B58.match(v):
                src = "completion" if v.startswith("3zNWsdDx") else "threshold" if v.startswith("4KNLFE1e") else "receipt"
                out["signaturePrefix"] = v[:12] + "…"
                out["signatureSha256"] = hashlib.sha256(v.encode()).hexdigest()
                out["signatureSource"] = SOURCES[src]
            else:
                out[k] = walk(v)
        return out
    if isinstance(x, list):
        return [walk(v) for v in x]
    if isinstance(x, str) and re.search(r"[1-9A-HJ-NP-Za-km-z]{86,88}", x):
        raise SystemExit(f"unhandled long base58 string: {x[:12]}…")
    return x

json.dump(walk(json.load(open(sys.argv[1]))), sys.stdout, indent=2, ensure_ascii=False)
print()
