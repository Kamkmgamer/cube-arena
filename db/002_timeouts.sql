-- A serverless function that dies mid-transaction must not hold row locks on
-- an attempt or run indefinitely.
alter role cube_app set idle_in_transaction_session_timeout = '20s';
