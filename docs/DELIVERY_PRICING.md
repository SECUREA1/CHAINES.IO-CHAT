# Ontario delivery estimates

Standard Core requests start at **CA$0.00**, with tip, purchase budget and route distance all initially zero. This is a CHAINeS service policy, not a claim that an outside merchant or carrier offers free shipping. No payment is collected by this form.

`static/delivery-pricing.js` is shared by browser summaries, downloadable/printable receipts and server confirmations. The server recalculates totals, persists the full receipt, and returns that breakdown. Duplicate request IDs do not create another order or email. Saved receipts preserve their original pricing breakdown.

## Rates

- Core / standard: $0; first 5 km included. Additional distance: $0.75/km.
- Package weight over 5 kg: $1/kg, explicitly entered by the customer.
- Pro / Elite tier upgrades: $3 / $6. Express / Priority speed upgrades: $3 / $6, added separately.
- Ordinary handling preferences: $0. Tip: voluntary, initially $0.
- Purchase budget is a spending limit for items, **never a second charge**. A nonzero limit below the item subtotal prevents submission.

Menu prices are editable **planning assumptions**, not verified live Ontario retailer prices or a guaranteed competitive offer. Examples: breakfast $8.99, lunch $12.99, dinner $16.99, prepared salmon $21.99, family tray $49.99; coffee $2.49, smoothie $6.99, milkshake $6.49. Grocery estimates include explicit pack sizes in the selector. Unknown grocery items require a user-entered unit price rather than an invented default. Merchant prices and third-party carrier postage require confirmation.

Tax estimates use 13% Ontario HST for taxable items and delivery, zero rating for the listed basic grocery staples, and a 5% prepared-food estimate when eligible prepared-food items total at most $4. Tips are voluntary and excluded from the tax base. Custom grocery goods default to taxable. Merchant tax classification and rebate eligibility must be confirmed for the actual sale.

Reference resources for rate maintenance (live retrieval was blocked in the implementation environment):

- CRA GST/HST rates: https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html
- Ontario prepared food rebate: https://www.ontario.ca/document/harmonized-sales-tax-hst/point-sale-rebate-prepared-food-and-beverages
- Statistics Canada retail food prices, table 18-10-0245-01: https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810024501

## Receipts

Receipts say **estimate / request confirmation**, identify CAD, item quantities, adjustments, delivery upgrades, distance/weight, item tax, delivery HST, tip and total. They state **payment not collected**. Receipt email availability is returned explicitly; missing credentials or email failures are not described as a durable queue. Customer copies are opt-in and require an email address. Printing and saving work even when email is unavailable.

Tests use isolated databases and blank email/SMS credentials. No production requests or outbound email are needed to validate this flow.
