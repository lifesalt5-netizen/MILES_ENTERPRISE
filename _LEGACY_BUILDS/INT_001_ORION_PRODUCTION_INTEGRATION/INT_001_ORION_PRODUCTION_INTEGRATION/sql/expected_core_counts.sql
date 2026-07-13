-- INT_001 ORION Core Count Checks
SELECT 'contractors' AS table_name, COUNT(*) AS row_count FROM contractors
UNION ALL
SELECT 'buyers', COUNT(*) FROM buyers
UNION ALL
SELECT 'prime_recs', COUNT(*) FROM prime_recs
UNION ALL
SELECT 'opportunities', COUNT(*) FROM opportunities
UNION ALL
SELECT 'recompetes', COUNT(*) FROM recompetes;
