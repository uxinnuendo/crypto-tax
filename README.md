# Quick start

1. Populate the crypto-data.csv with your buy/sell history:

[date],[coin],['buy'|'sell'],[units],[unit value]

2. Setup and run the script

```bash
$ yarn
$ yarn start
```

# BTC Markets Sales Transaction Report

Auto generate a report for each financial year:

1. Export CSV data from BTC Markets

Save the export as data/btc-export.csv

2. Run the report generator

```bash
$ yarn btc-markets
```

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
