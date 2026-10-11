-- At most two devices per sync group.
--
-- A trigger, because nothing declarative can say it: a CHECK constraint only
-- sees the row being written (SQLite allows no subqueries in one), and
-- UNIQUE/foreign keys can't count. The count and the insert run as one
-- statement, so two devices claiming codes for the same group at once can't
-- both see "one device" and both join — the race a check in the endpoint
-- alone would have. The endpoints check first too, but only to answer with a
-- clear message; this is what actually holds the limit.
--
-- The 2 is repeated as MAX_DEVICES_PER_GROUP in functions/api/sync/_shared.ts.
-- /claim recognises the abort by its message, so keep the two in step.

CREATE TRIGGER device_group_limit
BEFORE INSERT ON device
WHEN (SELECT COUNT(*) FROM device WHERE group_id = NEW.group_id) >= 2
BEGIN
  SELECT RAISE(ABORT, 'sync group full');
END;
