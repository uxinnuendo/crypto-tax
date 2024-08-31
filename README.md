# Quick start

1. Populate the crypto-data.csv with your buy/sell history:

[date],[coin],['buy'|'sell'],[units],[unit value]

2. Setup and run the script

```bash
$ yarn
$ yarn start
```

# BTC Markets Sales Transaction Report

To auto-generate a tax report for each financial year:

1. Export transactional data from BTC Markets as CSV, save the export in data/btc-export.csv

2. Run the report generator

```bash
$ yarn btc-markets
```

## Generated CSV report

Includes the following columns:

Sale Date, Financial Year, Purchase Date, Coin, Purchased Value, Purchased Unit Price, Sale Value, Units Sold, Sale Unit Price, Gross Profit, Transaction Fees, Taxable Amount, 50% CGT Discount

## How it's calculated

### General

- Sales are attributed to and calculated against the earliest unsold purchase
  for tax purposes. Each sale unit volume is split against each purchase in chronological order
  ie. One sale may span multiple purchases, and vice versa.

- Sales of assets held longer than
  12 months are taxed at 50% (CGT discount). Taxable losses
  roll into the following year(s).

### Withdrawals and deposits

- A withdrawal/deposit is the relocation of an asset, it is NOT a transactional purchase, or sale.

- Sale transactions attributed against "deposit" or "reward" type assets will contribute
  100% of the asset sale value to the taxableProfit metric
  (minus sale transaction fees) since the original
  purchase value is unavailable.

### Taxable Profit

- ((gross sale value - purchase value) x 50% CGT discount) - transaction fees
