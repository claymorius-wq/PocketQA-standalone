#!/usr/bin/env bash
# Read-only re-check of the research's on-chain facts. Public JSON-RPC endpoints only; sends no
# transaction. Each step prints the exact command it runs, then the fields the research cites
# (trimmed with node). Usage: bash docs/reviews/reputation-proposal/research-recheck.sh
set -euo pipefail

run() { # $1 endpoint, $2 JSON-RPC body, $3 node expression over the parsed response `j`
  echo
  echo "\$ curl -s $1 -H 'content-type: application/json' -d '$2' | node -e '<print: $3>'"
  curl -s -m 30 "$1" -H 'content-type: application/json' -d "$2" |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(JSON.stringify($3))})"
}

echo "# Run: $(date -u +%Y-%m-%dT%H:%MZ)"
for net in mainnet-beta devnet; do
  U="https://api.$net.solana.com"
  for bytes in 0 165; do
    run "$U" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getMinimumBalanceForRentExemption\",\"params\":[$bytes]}" "j.result"
  done
  # Squads v4 program data: upgrade authority and last deploy slot.
  run "$U" '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["Fy3YMJCvwbAXUgUM5b91ucUVA3jYzwWLHL3MwBqKsh8n",{"encoding":"jsonParsed","dataSlice":{"offset":0,"length":0}}]}' \
    "{authority:j.result.value.data.parsed.info.authority,lastDeploySlot:j.result.value.data.parsed.info.slot}"
done
# USDC mints: token program, decimals and freeze authority.
run "https://api.mainnet-beta.solana.com" '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",{"encoding":"jsonParsed"}]}' \
  "{owner:j.result.value.owner,decimals:j.result.value.data.parsed.info.decimals,freezeAuthority:j.result.value.data.parsed.info.freezeAuthority}"
run "https://api.devnet.solana.com" '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",{"encoding":"jsonParsed"}]}' \
  "{owner:j.result.value.owner,decimals:j.result.value.data.parsed.info.decimals,freezeAuthority:j.result.value.data.parsed.info.freezeAuthority}"
