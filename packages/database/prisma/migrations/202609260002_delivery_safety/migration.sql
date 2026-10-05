-- Historical send exceptions did not establish whether Gmail accepted the email.
-- Prevent retries of these ambiguous attempts.
UPDATE "JobApplication" SET "status" = 'SEND_UNCERTAIN', "detail" = 'Previous send failed without a definitive delivery result. Check Gmail Sent before applying again. ' || "detail" WHERE "status" = 'FAILED';
