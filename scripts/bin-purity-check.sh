#!/bin/bash
# bin/ purity check — prevents business logic from leaking into the harness public package.
# Called by pre-commit hook. Only harness.js (CLI entry) belongs in bin/.
# Other scripts should go in studio/bin/ or equivalent project-level directory.

EXTRA=$(ls bin/ 2>/dev/null | grep -v '^harness.js$' || true)
if [ -n "$EXTRA" ]; then
  echo "❌ bin/ must contain only harness.js (CLI entry)"
  echo "   Offending: $EXTRA"
  echo "   Business logic scripts belong in studio/bin/, not in the harness npm package."
  exit 1
fi
