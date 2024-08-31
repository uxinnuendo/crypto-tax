import fs from "node:fs";

const Decimal = require("decimal.js");

const [csvFilename] = process.argv.slice(2);
const dataFile = csvFilename || "crypto-data.csv";

type Action = "buy" | "sell" | "withdraw";

interface Data {
  date: Date;
  action: Action;
  coin: string;
  units: number;
  unitPrice: number;
  unitsSold: number;
  saleValue: number;
  transactionFee: number;
  totalProfit: number;
  taxableProfit: number;
  sellOrders: any[];
  refId: string | null;
}

interface Fee {
  key: string;
  amount: number;
}

const totals = {
  units: <any>{},
  perCoin: <any>{},
  taxSales: <any>[],
  breakeven: <Record<string, any>>{},
  total: <Record<string, any>>{},
};

const saleTransactionKey = <Record<string, any>>{};

const audit = <any>{};

/**
 * Sales are calculated against the earliest unsold purchase
 *  for tax purposes. Sales of assets held longer than
 *  12 months are taxed at 50% (CGT discount). Taxable losses
 *  roll into the following year(s).
 *
 * Withdrawals and deposits are based on BTC Markets ie. no unit
 *  value is available. A withdrawal/deposit is the relocation
 *  of an asset, it is NOT a transactional purchase, or sale.
 *
 * taxableProfit = ((gross sale value - purchase value) * 50% cgt discount) - fees
 *
 * Sale transactions from "deposit" or "reward" type assets will contribute
 *  100% value to taxableProfit (minus sale transaction fees) since we don't
 *  have the original purchase value data.
 *
 */

const program = () => {
  process.stdout.write(
    "**** NOTICE ****\nOnly supports up to 10 decimal places, calculations with smaller units will fail inextricably.\n\n"
  );

  const rawData = fs.readFileSync("./data/" + dataFile).toString();
  const rows = rawData.split(/\n/g);

  const sellData = <Data[]>[];
  const buyData = <Data[]>[];
  const feeData = <Fee[]>[];

  /* Pre-processing data */
  for (const row of rows) {
    if (!row) continue;

    const [dateStr, coin, action, units, unitPrice, refId] = row.split(",");

    const isBuy = action === "buy";
    const isSell = action === "sell";
    const isFee = action === "fee";
    const isDeposit = action === "deposit";
    const isReward = action === "reward";
    const isWithdraw = action === "withdraw";

    if (isFee) {
      const feeItem = {
        key: getTransactionKey(new Date(dateStr), coin, refId),
        amount: parseFloat(unitPrice),
      };

      feeData.push(feeItem);
      continue;
    }

    const addData: Data = {
      date: new Date(dateStr),
      coin,
      action: action as Action,
      units: units ? parseFloat(units) : 0,
      unitPrice: parseFloat(unitPrice),
      unitsSold: 0,
      saleValue: 0,
      transactionFee: 0,
      totalProfit: 0,
      taxableProfit: 0,
      sellOrders: [],
      refId,
    };

    if (isBuy || isSell) {
      const key = getTransactionKey(addData.date, addData.coin, addData.refId);
      saleTransactionKey[key] = addData;
    }

    const isBuyType = isBuy || isDeposit || isReward;
    const updateObject = isBuyType ? buyData : sellData;

    updateObject.push(addData);

    if (!totals.units[coin]) {
      totals.units[coin] = 0;
    }

    if (isBuy || isDeposit || isReward) {
      const cnUnits = totals.units[coin];
      totals.units[coin] = mathAdd(cnUnits, parseFloat(units));
    }

    if (!audit[coin]) {
      audit[coin] = {
        buy: 0,
        desposit: 0,
        reward: 0,
        sell: 0,
        withdraw: 0,
        active: 0,
      };
    }

    audit[coin][action] = mathAdd(audit[coin][action] || 0, parseFloat(units));

    audit[coin].active = mathAdd(
      audit[coin].active,
      isBuy || isDeposit || isReward ? parseFloat(units) : -parseFloat(units)
    );
  }

  /**
   * Process fees - add to associated buy/sell transaction
   * via pointer reference */
  for (const fee of feeData) {
    const { key, amount } = fee;
    saleTransactionKey[key].transactionFee = amount;
  }

  /* Process sale transactions */
  for (const sold of sellData) {
    const isWithdraw = sold.action === "withdraw";

    if (isWithdraw) {
      totals.units[sold.coin] = mathSub(
        totals.units[sold.coin],
        Number(sold.units)
      );
      continue;
    }

    if (sold.unitsSold === sold.units) {
      continue;
    }

    for (const bought of buyData) {
      if (
        bought.coin !== sold.coin ||
        bought.date > sold.date ||
        bought.unitsSold === bought.units
      ) {
        continue;
      }

      if (compareAndUpdateBought(bought, sold)) {
        break;
      }
    }
  }

  writeTaxReport();

  // calculateBreakeven(buyData);

  // console.log("\n*** PRE-AUDIT (ACTIVE) ***");
  // console.log(audit);
  // console.log("\n*** PRE-AUDIT UNITS (BOUGHT) ***");
  // console.log(totals.units);
  // console.log("\n*** Transactional Tax Calculations ***");
  // console.log(totals.taxSales);
  console.log("\n*** Totals ***");
  console.log(totals.total);
  // console.log("*** Per Coin Sales ***");
  // console.log(totals.perCoin);
  console.log("\n*** Current Coin Assets ***");
  console.log(totals.units);
};

const getTransactionKey = (date: Date, coin: string, refId: string | null) => {
  const dateStr = date.toISOString();
  return `${dateStr}-${coin}-${refId}`;
};

const writeTaxReport = () => {
  const csvOutput = <any>[];

  csvOutput.push(
    `Sale Date, Financial Year, Purchase Date, Coin, Purchased Value, Purchased Unit Price, Sale Value, Units Sold, Sale Unit Price, Gross Profit, Transaction Fees, Taxable Amount, 50% CGT Discount\n`
  );

  for (const {
    coin,
    purchaseDate,
    purchaseValue,
    purchaseUnitPrice,
    saleValue,
    unitsSold,
    saleUnitPrice,
    saleDate,
    totalProft,
    financialYear,
    taxableProfit,
    capitalGainsDiscount,
    transactionFee,
    financialYear: saleYear,
  } of totals.taxSales) {
    const saleDateIso = saleDate.toISOString();
    const purchaseDateIso = purchaseDate.toISOString();

    csvOutput.push(
      `${saleDateIso},${financialYear},${purchaseDateIso},${coin},${purchaseValue},${purchaseUnitPrice},${saleValue},${unitsSold},${saleUnitPrice},${totalProft},${transactionFee},${taxableProfit},${capitalGainsDiscount}\n`
    );
  }

  const writeFile = "tax-report.csv";
  fs.writeFileSync("./data/" + writeFile, csvOutput.join(""));
};

const calculateBreakeven = (buyData: Data[]) => {
  const coins = Object.keys(totals.units);
  const coinUnits = JSON.parse(JSON.stringify(totals.units));

  const updateBreakdown = (sellOrder: any) => {
    const { coin, totalProft } = sellOrder;
    if (!totals.breakeven[coin]) {
      totals.breakeven[coin] = {
        unitPrice: 0,
        value: 0,
      };
    }

    totals.breakeven[coin].value = mathAdd(
      totals.breakeven[coin].value,
      -totalProft
    );
  };

  for (const coin of coins) {
    const sold: Data = {
      coin,
      action: "sell",
      date: new Date(),
      units: totals.units[coin],
      unitPrice: 0,
      unitsSold: 0,
      transactionFee: 0,
      saleValue: 0,
      totalProfit: 0,
      taxableProfit: 0,
      sellOrders: [],
      refId: null,
    };

    for (const bought of buyData) {
      if (
        bought.coin !== sold.coin ||
        bought.date > sold.date ||
        bought.unitsSold === bought.units
      ) {
        continue;
      }

      if (compareAndUpdateBought(bought, sold, updateBreakdown)) {
        break;
      }
    }
  }

  // Restore totals.units
  totals.units = coinUnits;

  for (const coin of coins) {
    const sellValue = parseFloat(totals.breakeven[coin]?.value) || 0;
    const activeUnits = parseFloat(totals.units[coin]) || 0;

    if (!sellValue) {
      continue;
    }

    totals.breakeven[coin].unitPrice = mathDiv(sellValue, activeUnits);
  }

  console.log("\n*** Breakeven Sale Value ***");
  console.log(totals.breakeven);
};

const compareAndUpdateBought = (
  bought: Data,
  sold: Data,
  cb?: (...args: any[]) => void
) => {
  const boughtUnitsToSell = mathSub(bought.units, bought.unitsSold);
  const unitsSelling = mathSub(sold.units, sold.unitsSold);

  const sellUnits = pf(
    unitsSelling > boughtUnitsToSell ? boughtUnitsToSell : unitsSelling
  );

  const unitPrice = bought.unitPrice || 0;
  const soldUnitPrice = sold.unitPrice || 0;

  const valueOfBuy = mathMul(sellUnits, unitPrice);
  const valueOfSale = mathMul(sellUnits, soldUnitPrice);

  const transactionFee = pf(
    mathAdd(bought.transactionFee, sold.transactionFee)
  );

  // Avoid duplication of fees on additional sales
  bought.transactionFee = 0;
  sold.transactionFee = 0;

  const diff = mathSub(valueOfSale, valueOfBuy);
  const capitalGainsDiscount = monthDiff(bought.date, sold.date) > 12;
  const taxableProfit = mathSub(
    diff > 0 && capitalGainsDiscount ? mathDiv(diff, 2) : diff,
    transactionFee
  );

  bought.saleValue = mathAdd(bought.saleValue, valueOfSale);
  bought.unitsSold = mathAdd(bought.unitsSold, sellUnits);
  bought.totalProfit = diff;
  bought.taxableProfit = mathAdd(bought.taxableProfit, taxableProfit);

  const lastFY = sold.date.getMonth() < 6;
  const saleYear = sold.date.getFullYear() + (lastFY ? -1 : 0);

  const sellOrderHistory = {
    coin: sold.coin,
    purchaseDate: bought.date,
    purchaseValue: mathMul(sellUnits, unitPrice),
    purchaseUnitPrice: unitPrice,
    saleValue: valueOfSale,
    unitsSold: sellUnits,
    transactionFee,
    saleUnitPrice: soldUnitPrice,
    saleDate: sold.date,
    totalProft: diff,
    taxableProfit,
    capitalGainsDiscount,
    financialYear: saleYear,
  };

  bought.sellOrders.push(sellOrderHistory);

  sold.unitsSold = mathAdd(sold.unitsSold, sellUnits);

  if (!totals.perCoin[sold.coin]) {
    totals.perCoin[sold.coin] = {
      totalPurchaseValue: 0,
      grossSaleValue: 0,
      transactionFees: 0,
      totalTaxableProfit: 0,
    };
  }

  const cnTotal = totals.perCoin[sold.coin];

  cnTotal.totalPurchaseValue = mathAdd(cnTotal.totalPurchaseValue, valueOfBuy);
  cnTotal.transactionFees = mathAdd(cnTotal.transactionFees, transactionFee);
  cnTotal.grossSaleValue = mathAdd(cnTotal.grossSaleValue, valueOfSale);
  cnTotal.totalTaxableProfit = mathAdd(
    cnTotal.totalTaxableProfit,
    taxableProfit
  );

  const fy = `fy${saleYear}`;

  if (!totals.total[fy]) {
    const priorFY = `fy${saleYear - 1}`;
    const prevTaxableProfit = totals.total[priorFY]?.taxableProfit;
    const taxableProfit = prevTaxableProfit < 0 ? prevTaxableProfit : 0;

    totals.total[fy] = {
      purchaseValue: 0,
      grossSaleValue: 0,
      transactionFees: 0,
      totalProfit: 0,
      taxableProfit,
    };
  }

  const tt = totals.total[fy];

  tt.purchaseValue = mathAdd(tt.purchaseValue, valueOfBuy);
  tt.transactionFees = mathAdd(tt.transactionFees, transactionFee);
  tt.grossSaleValue = mathAdd(tt.grossSaleValue, valueOfSale);
  tt.totalProfit = mathAdd(tt.totalProfit, diff);
  tt.taxableProfit = mathAdd(tt.taxableProfit, taxableProfit);

  totals.taxSales.push(sellOrderHistory);

  const cnUnits = totals.units[sold.coin];
  totals.units[sold.coin] = mathSub(cnUnits, sellUnits);

  cb?.(sellOrderHistory);

  if (sold.unitsSold === sold.units) {
    return true; // break from buyData loop
  }

  return false;
};

// Avoid the JS float glitch
const mathAdd = (x: number, y: number) => {
  return pf(Decimal.add(x, y));
};

const mathSub = (x: number, y: number) => {
  return pf(Decimal.sub(x, y));
};

const mathDiv = (x: number, y: number) => {
  return pf(Decimal.div(x, y));
};

const mathMul = (x: number, y: number) => {
  return pf(Decimal.mul(x, y));
};

const pf = (x: any) => parseFloat(x);

const monthDiff = (dateFrom: Date, dateTo: Date) => {
  return (
    dateTo.getMonth() -
    dateFrom.getMonth() +
    12 * (dateTo.getFullYear() - dateFrom.getFullYear())
  );
};

program();
