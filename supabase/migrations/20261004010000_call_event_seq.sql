-- Transcript lines are synced from Vapi's conversation history, which is sent
-- again in full on every turn. `seq` is the line's position in the call, so a
-- re-sync updates lines in place instead of duplicating them.
alter table call_events add column seq int;
alter table call_events add constraint call_events_call_seq_key unique (call_id, seq);
