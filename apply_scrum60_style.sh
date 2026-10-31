#!/usr/bin/env bash
set -euo pipefail

# SCRUM-60 follow-up: style the affected-bookings table like the existing
# "Decided bookings" table on the Venues page.
#
# Run this FROM YOUR EXISTING scrum-60/affected-bookings branch (the one your
# open PR is on) -- it edits the file in place, it does not create a branch
# or fetch main. It does NOT commit and does NOT push.
#
# What this changes:
#   frontend/src/components/AffectedBookingsCard.jsx: the results <table> gets
#   className="table" (the same class the "Decided bookings" table on this
#   page already uses -- defined in styles.css: proper column padding,
#   bottom-border rows, muted header text) plus an id for consistency with
#   the other table on the page (#bookings-table).

TARGET=frontend/src/components/AffectedBookingsCard.jsx

if [ ! -f "$TARGET" ]; then
  echo "ERROR: expected file not found: $TARGET" >&2
  echo "Are you on the scrum-60/affected-bookings branch, at the repo root?" >&2
  exit 1
fi

echo "Styling the affected-bookings table..."
python3 - "$TARGET" <<'PYEOF'
import sys
path = sys.argv[1]
text = open(path, encoding='utf-8').read()

old = '          <table>\n'
new = '          <table className="table" id="affected-bookings-table">\n'
assert text.count(old) == 1, f"expected exactly one bare <table> in {path}, found {text.count(old)}"
text = text.replace(old, new, 1)

open(path, 'w', encoding='utf-8').write(text)
print(f"  {path}: table now uses the shared .table style")
PYEOF

echo ""
echo "Running the affected-bookings frontend tests..."
(cd frontend && npx jest AffectedBookingsCard.test.jsx)

echo ""
echo "Running the full frontend suite to check for regressions..."
(cd frontend && npx jest)

echo ""
echo "Done. File edited, nothing committed, nothing pushed."
echo "Review with: git diff"
echo "When happy: git add -A && git commit -m '...' && git push"
