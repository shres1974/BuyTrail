# 0002 — Local object storage: SeaweedFS instead of MinIO

Status: accepted (2026-11-04, previous session)

MinIO images could not be pulled from the development network. SeaweedFS 3.80 exposes an S3-compatible API on :9000 with static credentials (`infra/seaweedfs/s3.json`). The application uses only the generic S3 API (`@aws-sdk/client-s3`, path-style), so any private S3-compatible store works in deployment. `pnpm doctor` checks the bucket with an anonymous GET; it must return 401/403.
