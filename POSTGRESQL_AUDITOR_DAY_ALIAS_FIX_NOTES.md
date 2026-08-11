# PostgreSQL Auditor Day Alias Fix

- Replaced the unquoted `day` SQL alias in the Auditor dashboard risk trend query with `event_day`.
- Uses ordinal `GROUP BY 1` / `ORDER BY 1` for PostgreSQL-safe aggregation.
- Renames the dataframe column back to `day` after the query so the chart and visible UI remain unchanged.
- Extended the PostgreSQL compatibility audit to reject unqualified `day`, `month`, or `year` aliases after `substr(...)`.
- Added regression coverage for the affected Auditor dashboard query.
