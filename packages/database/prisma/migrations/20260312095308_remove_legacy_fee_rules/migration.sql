-- Remove legacy fee rules that should not be used anymore.
DELETE FROM "FeeRule"
WHERE "id" IN ('fee-1', 'fee-2', 'fee-3');