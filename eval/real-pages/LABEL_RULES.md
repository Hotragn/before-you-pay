# Real-page study: labeling rules (written before any check ran)

Pages: 12 public plan/signup pages captured logged out on 2026-11-22 by running the extension's content.js on each page.
No account created, nothing entered, no payment step reached. Snapshots stay local (not in the public repo).
Dropped before labeling: one page whose plans did not render without signing in, one that served non-US prices.
Ids here (p01 to p10) are renumbered and sites are named by category only.

Labels come only from the captured text (what the checker sees), not from what the site may show elsewhere.
- trial: the most prominent free trial ($0 period) stated in the text, with the price it becomes if stated. A paid intro price (e.g. $1 for 3 months) is not a free trial.
- recurring: every distinct amount stated as a per-period price (per week/month/year, every 4 weeks, "more/mo"). One-time multi-month totals and prepaid non-renewing plans are excluded.
- auto_renew: true only when the text says it renews, is recurring billing, or continues until you cancel. "then $X/month" or "cancel anytime" alone does not count.
- prechecked_paid_addons: ticked boxes that add a paid item. Ticked cookie/ad consent toggles are not paid add-ons.
- fees: named extra fees with an amount. "taxes and fees may apply" with no amount is not labeled.
- has_cancel_or_terms_link: a link the checker would keep (terms/cancel/subscription text, http(s), no query string).
Labels were drafted with an AI assistant from the snapshot text before anything ran, and committed locally at 04:28 EST on Nov 22 (sha256 of the original file f473c097...). They have not been changed since.
