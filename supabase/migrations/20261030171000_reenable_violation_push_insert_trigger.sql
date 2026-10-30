-- Re-enable DB insert webhook after durable email idempotency is in place.
-- Safe if already enabled. Do not apply until violation-push with
-- athar_claim_violation_email is deployed (or client fallback alone is acceptable).

ALTER TABLE public.violations ENABLE TRIGGER athar_violation_push_after_insert;
