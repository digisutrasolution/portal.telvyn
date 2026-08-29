# ADR-0009 — Telecom credential vault (secret material separation)

- **Status:** Accepted
- **Date:** 2026-08-29
- **Deciders:** Architect / Security / Telecom (Phase 12A)
- **Related:** SECURITY.md, ADR-0008, crypto.util (encryptSecret/decryptSecret)

## Context

SIP trunks and carriers carry secret material (SIP passwords, carrier API
credentials). The constitution and the Phase-12 authorization forbid plaintext
telecom secrets and any leakage through API responses, logs, audit, git, or
frontend. The codebase already encrypts secrets at rest with AES-256-GCM
(`encryptSecret`/`decryptSecret` under `APP_ENCRYPTION_KEY`, used for
`User.mfaSecretEnc`).

## Decision

Enforce a hard separation between **operational telecom configuration** and
**secret material** via a dedicated **`TelecomCredential` vault table**.

- **Vault row** holds: id, `tenantId` (nullable — platform or tenant, mirrors
  the owning carrier/trunk), `type` (SIP_PASSWORD | CARRIER_API | …), `label`,
  a non-secret `hint` (e.g. username or last-4), the **encrypted secret**
  (`secretEnc`, AES-256-GCM via the existing helper), `createdAt/updatedAt`,
  and a `rotatedAt`. Config tables (`Carrier`, `SipTrunk`) reference a
  `credentialId`; they **never** contain a plaintext secret column.
- **Never exposed.** No API DTO includes `secretEnc` or a decrypted value.
  List/detail responses return only the reference id + non-secret `hint`. The
  decrypted secret is produced **only** inside the adapter layer, at the
  narrowest server-side boundary, at the moment an engine call needs it — never
  returned to a controller, never serialized.
- **No generic ORM serialization of secrets.** The vault service exposes typed
  methods (`createCredential`, `getHint`, and an internal
  `revealForAdapter(credentialId, ctx)` restricted to adapter use); `secretEnc`
  is never selected into general-purpose read paths.
- **RBAC + audit.** Credential create/rotate/delete require dedicated
  permissions and are audited via the existing `AuditService` — with the secret
  value **redacted** from audit metadata and from `TelecomConfigVersion`
  snapshots (only the credential id/hint is recorded).
- **No secret in logs.** Structured logging and error paths must never include
  `secretEnc` or a decrypted value.
- **External-manager compatible.** `TelecomCredential` is a *reference* the
  rest of the system depends on. Today the backing store is the encrypted
  column; a future ADR can repoint `revealForAdapter` at an external secret
  manager (Vault/KMS) without touching carriers, trunks, or APIs — the
  reference contract is stable.

## Consequences

- "Never expose a secret" becomes structural, not a per-endpoint discipline:
  secrets live in one table, behind one service, revealed at one boundary.
- Rotation and future external-manager migration are localized to the vault
  service.
- Security tests (12L) assert no telecom endpoint ever returns credential
  material and that audit/config-version rows are secret-free.
