# TELECOM.md — Telvyn DID Portal PROMAX

> Status taxonomy: see PROJECT_STATE.md.

## Current state — EXISTING

**No telecom integration exists.** No carrier is contracted or selected.

## DID lifecycle — PLANNED (canonical state machine, per constitution)

```
AVAILABLE → RESERVED → ASSIGNED → (PORTING_OUT) → RELEASED
     ↑                      |
     └──────────────────────┘ (unassign/recycle)
PORTING_IN → ASSIGNED
```

Every transition audited and permission-gated.

## Hard constraints — PLANNED (non-negotiable, per constitution)

- Toll-fraud guards (rate/velocity/geo/spend limits, balance checks) are
  day-one requirements on any call-affecting feature.
- If Telvyn ever operates SIP/RTP: directly reachable public-IP hosts only —
  never behind Cloudflare/HTTP proxies; no business logic or static dialplans
  in media servers.

## UNKNOWN (all need owner decisions/contracts)

1. DID supply: which upstream carrier(s)/provider(s); API-automated vs manual ordering
2. Delivery model: SIP trunk / PSTN forward / registration — determines whether
   Telvyn runs any signalling-media plane at launch or is pure control plane
3. Launch market(s) → regulatory surface: STIR/SHAKEN, emergency services,
   porting/LOA obligations, KYC for numbers, robocall mitigation
4. CDR source: carrier files/webhooks vs own switch records
5. SMS scope: in or out of the product

## Integrations

None — documented per carrier as each is contracted.
