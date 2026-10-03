-- Outbound phone calls to customers: a new action type, and a separate
-- consent for being called (texting consent does not cover calls).
alter table actions drop constraint actions_type_check;
alter table actions add constraint actions_type_check check (type in ('email', 'sms', 'invoice', 'call'));

alter table customers add column call_consent boolean not null default false;
