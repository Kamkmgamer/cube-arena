-- The database (60 connections) is shared with other KRNL apps. Cube Arena's
-- transactions are short, so a few server connections are plenty; under a
-- spike it queues or errors on its own, without starving its neighbours.
alter role cube_app connection limit 8;
