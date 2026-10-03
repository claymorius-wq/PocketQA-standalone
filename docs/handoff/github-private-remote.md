# GitHub private-remote handoff: readiness (NOT executed)

Status, checked locally on 2026-10-03: **ready to hand off, not pushed.** No remote exists, and no `gh` or remote command has been run against GitHub. Every remote write needs Hamza's explicit go-ahead for that action (handoff §5).

## Local facts (checked, read-only)

| Check | Result |
|---|---|
| Remotes | none (`git remote -v` lists nothing) |
| Commit identity | local `.git/config`: `reshareai <284803537+reshareai@users.noreply.github.com>`. Every commit on `main` uses this identity (`git log --format='%an <%ae>' \| sort -u`). |
| `gh` | 2.86.0 installed. **Not** used, and no auth status was queried. |
| **Credential helper risk** | System git config (`/Applications/Xcode.app/.../gitconfig`) sets `credential.helper=osxkeychain`. A plain `git push` over HTTPS could silently use whatever account the keychain holds, possibly the ambient `hamzadiaz`. **Never push without disabling it for that command.** |
| Secrets | `pnpm check:secrets` passes. Env files, keys, data, APKs and Maestro results are git-ignored. |
| Size | `.git` is about 16 MB, including review screenshots. |

## Steps to run only after Hamza authorizes the specific action

1. **Get a scoped token.** It must be a fine-grained `reshareai` token with access only to the target repo (repo creation, plus contents read/write), taken from the keychain or a password manager. Never echo it, write it to a file, or put it in a URL.
2. **Verify the account for this command only:**
   ```sh
   GH_TOKEN="$TOKEN" gh api user --jq .login   # must print exactly: reshareai
   ```
   Stop if it prints anything else.
3. **Create the private repo** (only if it doesn't exist yet):
   ```sh
   GH_TOKEN="$TOKEN" gh repo create reshareai/pocket-qa --private --source . --remote origin
   ```
4. **Push** with the keychain helper disabled and the token supplied for this command only. The helper reads `$GH_TOKEN`, so it must be set on the same command line:
   ```sh
   GH_TOKEN="$TOKEN" git -c credential.helper= \
       -c credential.helper='!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f' \
       push origin main
   ```
   Use no `--force`. Push `main` only, unless Hamza asks for review branches too.
5. **Re-check** that `git remote -v` shows `https://github.com/reshareai/pocket-qa.git`, and that the repo is private (`GH_TOKEN=… gh repo view reshareai/pocket-qa --json visibility`).

Never: `gh auth login`, `gh auth switch`, changes to the global git config, or a token embedded in the remote URL.
