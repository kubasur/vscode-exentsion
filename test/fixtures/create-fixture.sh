#!/usr/bin/env bash
# Creates the Taskbench test fixture: a small layered Python repository.
#
#   main             a clean codebase with .taskbench/rules.json
#   feature/planted  a branch with known diffs and exactly three planted structure problems:
#                      1. encapsulation break: api/handlers.py imports orders/_pricing.py (private to orders)
#                      2. upward import:       db/migrations.py (layer 3) imports billing/invoice.py (layer 2)
#                      3. new cycle:           orders/service.py <-> billing/invoice.py
#                    The packages are arranged so these stay exactly three findings at both file and
#                    package granularity (no other package-level cycle appears).
#
# Known diff of feature/planted against main (git diff --name-status -M main...feature/planted):
#   M  api/handlers.py
#   M  billing/invoice.py
#   A  db/__init__.py
#   A  db/migrations.py
#   D  legacy.py
#   M  orders/service.py
#   R  utils.py -> common/text.py
#
# Usage: create-fixture.sh <target-dir>   (the directory must not exist yet)
set -euo pipefail

target="${1:?usage: create-fixture.sh <target-dir>}"
if [ -e "$target" ]; then
  echo "error: $target already exists" >&2
  exit 1
fi

mkdir -p "$target"
cd "$target"

export GIT_AUTHOR_NAME="Taskbench Fixture" GIT_AUTHOR_EMAIL="fixture@example.invalid"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
commit() {
  export GIT_AUTHOR_DATE="2026-01-0$1T12:00:00Z" GIT_COMMITTER_DATE="2026-01-0$1T12:00:00Z"
  git add -A
  git commit -q -m "$2"
}

git init -q -b main
git config commit.gpgsign false

write() {
  mkdir -p "$(dirname "$1")"
  cat > "$1"
}

# --- main: a clean layered codebase -------------------------------------------------------

write README.md <<'EOF'
# Fixture shop

A tiny layered codebase used by the Taskbench tests: api -> orders, billing -> infra, db.
EOF

write .taskbench/rules.json <<'EOF'
{
  "layers": [["api"], ["orders", "billing"], ["infra", "db"]],
  "privatePatterns": { "python": ["^_"], "typescript": ["@internal", "notExported"] },
  "allowed": [{ "from": "billing/**", "to": "billing/_*" }],
  "forbidden": [{ "from": "api/**", "to": "**/repo*", "reason": "handlers go through services" }]
}
EOF

write api/__init__.py <<'EOF'
EOF

write api/handlers.py <<'EOF'
from orders.service import place_order


def current_user():
    return "demo"


def post_order(sku, quantity):
    return place_order(current_user(), sku, quantity)
EOF

write orders/__init__.py <<'EOF'
EOF

write orders/_pricing.py <<'EOF'
PRICES = {"apple": 3, "pear": 4}


def base_price(sku):
    return PRICES[sku]
EOF

write orders/service.py <<'EOF'
from infra.db import save
from orders._pricing import base_price


def place_order(user, sku, quantity):
    order = {"user": user, "sku": sku, "quantity": quantity, "total": base_price(sku) * quantity}
    save("orders", order)
    return order
EOF

write billing/__init__.py <<'EOF'
EOF

write billing/_tax.py <<'EOF'
RATE = 0.2


def tax(amount):
    return amount * RATE
EOF

write billing/invoice.py <<'EOF'
from billing._tax import tax
from infra.db import save


def invoice(order):
    total = order["total"] + tax(order["total"])
    save("invoices", {"order": order, "total": total})
    return total
EOF

write infra/__init__.py <<'EOF'
EOF

write infra/db.py <<'EOF'
TABLES = {}


def save(table, row):
    TABLES.setdefault(table, []).append(row)
EOF

write utils.py <<'EOF'
def slug(text):
    return "-".join(text.lower().split())
EOF

write legacy.py <<'EOF'
def old_checkout():
    raise NotImplementedError("use api.handlers.post_order")
EOF

commit 1 "Initial fixture codebase"

# --- feature/planted: known diffs and three planted problems ------------------------------

git checkout -q -b feature/planted

# 1. Encapsulation break: api reaches into orders' private pricing module.
write api/handlers.py <<'EOF'
from orders._pricing import base_price
from orders.service import place_order


def current_user():
    return "demo"


def post_order(sku, quantity):
    return place_order(current_user(), sku, quantity)


def quote(sku, quantity):
    return base_price(sku) * quantity
EOF

# 3. New cycle: orders.service -> billing.invoice (billing.invoice -> orders.service below).
write orders/service.py <<'EOF'
from billing.invoice import invoice
from infra.db import save
from orders._pricing import base_price


def place_order(user, sku, quantity):
    order = {"user": user, "sku": sku, "quantity": quantity, "total": base_price(sku) * quantity}
    save("orders", order)
    invoice(order)
    return order
EOF

write billing/invoice.py <<'EOF'
from billing._tax import tax
from infra.db import save
from orders.service import place_order


def invoice(order):
    total = order["total"] + tax(order["total"])
    save("invoices", {"order": order, "total": total})
    return total


def reorder(order):
    return place_order(order["user"], order["sku"], order["quantity"])
EOF

commit 2 "Invoice every order and add quotes"

# 2. Upward import: db (bottom layer) imports billing (middle layer).
write db/__init__.py <<'EOF'
EOF

write db/migrations.py <<'EOF'
from billing.invoice import invoice


def backfill_invoices(orders):
    return [invoice(order) for order in orders]
EOF

# A rename and a delete, for diff status coverage.
mkdir -p common
git mv utils.py common/text.py
git rm -q legacy.py

commit 3 "Add invoice backfill, move utils, drop legacy checkout"

git checkout -q main
