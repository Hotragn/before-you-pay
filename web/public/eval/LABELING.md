# How these pages were labeled

16 made-up checkout and signup pages for fictional businesses. A first draft of the pages and labels was written with Claude; every label was then read and checked one by one against the page text.

Rules used:
- `trial`: a free period before the first paid charge. Intro discounts ("$1 for your first month", "50% off your first week") are not trials.
- `recurring`: every repeating price printed for the base plan or for add-ons that are already ticked, exactly as printed (including per-month equivalents like "$8.33/mo, billed annually at $99.99").
- `auto_renew`: true if the plan keeps charging until the customer acts. A plain monthly plan with "Cancel anytime" counts as true (changed by hand on f13: it bills monthly with no end date).
- `prechecked_paid_addons`: ticked by default and costs money. Ticked newsletters do not count. Unticked add-ons never count.
- `fees`: one-time or extra fees as printed (shipping per box, service, facility, processing, activation, enrollment, resort, maintenance).
- `has_cancel_or_terms_link`: a link about cancelling, terms, refunds or the membership agreement.

Two pages are plain one-time purchases (f06 software license, f15 concert tickets) and one is a fixed pass with "No automatic renewal" (f10), to catch false alarms.
