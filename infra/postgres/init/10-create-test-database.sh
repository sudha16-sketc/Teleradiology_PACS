#!/bin/sh
set -eu

# Keep end-to-end tests in their own database. This script runs only when the
# official PostgreSQL image initializes an empty data directory.
test_db="${POSTGRES_TEST_DB:-axis_pacs_test}"
case "$test_db" in
  ''|*[!a-zA-Z0-9_]* )
    echo "POSTGRES_TEST_DB must contain only letters, numbers, and underscores" >&2
    exit 1
    ;;
esac

if [ "$test_db" != "$POSTGRES_DB" ]; then
  createdb --username "$POSTGRES_USER" "$test_db"
fi
