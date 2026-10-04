# Objects created in `pocketqa-evidence` by the live R2 check (2026-10-04)

Read-only listing (`ListObjectsV2`) after the run. These are the bucket's **only** objects. It was empty before, and the test **deleted nothing**: deletes were intercepted, and the two quarantine deletes the app would normally perform were queued in its outbox instead.

| Key | Bytes | Origin |
|---|---|---|
| `quarantine/livemut5dotfa5e0fca` | 268 | Raw adapter: presigned PUT (MP4 fixture) |
| `evidence/livemut5dotfa5e0fca` | 268 | Raw adapter: ETag-pinned copy |
| `quarantine/f70456ff-0d2a-4c18-85fe-9d90c6bd3a58` | 268 | API flow: tester upload (verified) |
| `evidence/d145f146-d048-413d-8f48-ecc7605ded66` | 268 | API flow: promoted evidence, played back with ranges |
| `quarantine/26f65e83-45e2-4430-973d-8f4ac470a8b7` | 72 | API flow: spoofed PNG upload, rejected at completion |

Not created: the length- and type-mismatched PUTs (R2 refused them) and the stale-ETag copy (412). All objects are synthetic test fixtures. Removing them needs Hamza's approval.
