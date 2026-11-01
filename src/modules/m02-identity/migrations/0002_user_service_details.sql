-- M02 personnel details on the user record, as kept on the ship's nominal list.
-- trade_branch: free text (e.g. Electrical, Engineering, Seamanship). personnel_category: officer or sailor.
-- Both are optional so users created before this migration stay valid.
ALTER TABLE idn_user ADD COLUMN trade_branch TEXT;
ALTER TABLE idn_user ADD COLUMN personnel_category TEXT CHECK (personnel_category IN ('officer','sailor'));
