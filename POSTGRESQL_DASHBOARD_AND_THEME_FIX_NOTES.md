# PostgreSQL dashboard and runtime theme correction

- Added PostgreSQL `substr()` compatibility overloads for DATE, TIMESTAMP, and TIMESTAMPTZ values used by legacy SQLite-compatible reporting queries.
- Fixed the Admin Budget Risk crash without changing stored data or report semantics.
- Added a final theme bridge based on Streamlit's active CSS variables (`--background-color`, `--secondary-background-color`, `--text-color`, and `--primary-color`).
- Removed the dependency on browser/OS dark-mode detection for cards, hero banners, controls, tables, and the command bar.
- Replaced fixed white dashboard surfaces with theme-aware raised surfaces and strengthened text contrast.
- Refined the bright blue sidebar into a calmer branded navy rail.
