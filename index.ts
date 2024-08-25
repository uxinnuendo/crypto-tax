import fs from "node:fs";

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
  totalProfit: number;
  taxableProfit: number;
  sellOrders: any[];
}

const totals = {
  units: <any>{},
  perCoin: <any>{},
  taxSales: <any>[],
  breakeven: <Record<string, any>>{},
  total: <Record<string, any>>{},
};

const audit = <any>{};

/**
 * Sales are calculated against the earliest unsold purchase
 *  for tax purposes. Sales of assets held longer than
 *  12 months are taxed at 50% (CGT discount). Taxable losses
 *  roll into the following year(s). Withdrawals are based on
 *  BTC Markets (no unit value in report at time of withdrawal).
 *
 * Use https://github.com/MikeMcl/decimal.js for more precision
 *
 * TODO: Include transactional fees
 * TODO: Export all sale transactions to CSV
 */

const program = () => {
  process.stdout.write(
    "**** NOTICE ****\nOnly supports up to 10 decimal places, calculations with smaller units will fail inextricably.\n\n"
  );

  const rawData = fs.readFileSync("./data/" + dataFile).toString();
  const rows = rawData.split(/\n/g);

  const sellData = <Data[]>[];
  const buyData = <Data[]>[];

  for (const row of rows) {
    if (!row) continue;

    const [dateStr, coin, action, units, unitPrice] = row.split(",");

    const addData: Data = {
      date: new Date(dateStr),
      coin,
      action: action as Action,
      units: Number(units),
      unitPrice: Number(unitPrice),
      unitsSold: 0,
      saleValue: 0,
      totalProfit: 0,
      taxableProfit: 0,
      sellOrders: [],
    };

    const isBuy = action === "buy";
    const isWithdraw = action === "withdraw";

    if (isWithdraw) {
      const cnUnits = totals.units[coin];
      totals.units[coin] = precisionRound(cnUnits - Number(units));
    }

    const updateObject = isBuy ? buyData : sellData;
    updateObject.push(addData);

    if (!totals.units[coin]) {
      totals.units[coin] = 0;
    }

    if (isBuy) {
      const cnUnits = totals.units[coin];
      totals.units[coin] = precisionRound(cnUnits + Number(units));
    }

    if (!audit[coin]) {
      audit[coin] = {
        buy: 0,
        sell: 0,
        active: 0,
      };
    }

    audit[coin][action] = precisionRound(audit[coin][action] + Number(units));
    audit[coin].active = precisionRound(
      audit[coin].active + (isBuy ? Number(units) : -Number(units))
    );
  }

  for (const sold of sellData) {
    const isWithdraw = sold.action === "withdraw";
    if (isWithdraw || sold.unitsSold === sold.units) {
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

  // console.log("*** PRE-AUDIT (ACTIVE) ***");
  // console.log(audit);
  // console.log("*** PRE-AUDIT UNITS (BOUGHT) ***");
  // console.log(totals.units);
  // console.log("*** Transactional Tax Calculations ***");
  // console.log(totals.taxSales);
  console.log("*** Totals ***");
  console.log(totals.total);
  // console.log("*** Per Coin Sales ***");
  // console.log(totals.perCoin);
  console.log("*** Current Coin Assets ***");
  console.log(totals.units);

  calculateBreakeven(buyData);
};

const writeTaxReport = () => {
  const csvOutput = <any>[];

  csvOutput.push(
    `Sale Date, Financial Year, Purchase Date, Coin, Purchased Value, Purchased Unit Price, Sale Value, Units Sold, Sale Unit Price, Gross Profit, Taxable Amount, 50% CGT Discount\n`
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
    financialYear: saleYear,
  } of totals.taxSales) {
    const saleDateIso = saleDate.toISOString();
    const purchaseDateIso = purchaseDate.toISOString();

    csvOutput.push(
      `${saleDateIso},${financialYear},${purchaseDateIso},${coin},${purchaseValue},${purchaseUnitPrice},${saleValue},${unitsSold},${saleUnitPrice},${totalProft},${taxableProfit},${capitalGainsDiscount}\n`
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

    totals.breakeven[coin].value = precisionRound(
      totals.breakeven[coin].value + -totalProft
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
      saleValue: 0,
      totalProfit: 0,
      taxableProfit: 0,
      sellOrders: [],
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
    const activeUnits = totals.units[coin];
    const sellValue = totals.breakeven[coin]?.value;

    if (!sellValue) {
      continue;
    }

    totals.breakeven[coin].unitPrice = precisionRound(sellValue / activeUnits);
  }

  console.log("*** Breakeven Sale Value ***");
  console.log(totals.breakeven);
};

const compareAndUpdateBought = (
  bought: Data,
  sold: Data,
  cb?: (...args: any[]) => void
) => {
  const boughtUnitsToSell = bought.units - precisionRound(bought.unitsSold);
  const unitsSelling = sold.units - precisionRound(sold.unitsSold);

  const sellUnits = precisionRound(
    unitsSelling > boughtUnitsToSell ? boughtUnitsToSell : unitsSelling
  );

  const unitPrice = bought.unitPrice || 0;
  const soldUnitPrice = sold.unitPrice || 0;

  const valueOfBuy = precisionRound(sellUnits * unitPrice);
  const valueOfSale = precisionRound(sellUnits * soldUnitPrice);

  const diff = precisionRound(valueOfSale - valueOfBuy);
  const capitalGainsDiscount = monthDiff(bought.date, sold.date) > 12;
  const taxableProfit = diff > 0 && capitalGainsDiscount ? diff / 2 : diff;

  bought.saleValue = precisionRound(bought.saleValue + valueOfSale);
  bought.unitsSold = precisionRound(bought.unitsSold + sellUnits);
  bought.totalProfit = diff;
  bought.taxableProfit = precisionRound(bought.taxableProfit + taxableProfit);

  const lastFY = sold.date.getMonth() < 6;
  const saleYear = sold.date.getFullYear() + (lastFY ? -1 : 0);

  const sellOrderHistory = {
    coin: sold.coin,
    purchaseDate: bought.date,
    purchaseValue: precisionRound(sellUnits * unitPrice),
    purchaseUnitPrice: unitPrice,
    saleValue: valueOfSale,
    unitsSold: sellUnits,
    saleUnitPrice: soldUnitPrice,
    saleDate: sold.date,
    totalProft: diff,
    taxableProfit,
    capitalGainsDiscount,
    financialYear: saleYear,
  };

  bought.sellOrders.push(sellOrderHistory);

  sold.unitsSold = precisionRound(sold.unitsSold + sellUnits);

  if (!totals.perCoin[sold.coin]) {
    totals.perCoin[sold.coin] = {
      totalPurchaseValue: 0,
      grossSaleValue: 0,
      totalTaxableProfit: 0,
    };
  }

  const cnTotal = totals.perCoin[sold.coin];

  cnTotal.totalPurchaseValue = precisionRound(
    cnTotal.totalPurchaseValue + valueOfBuy
  );
  cnTotal.grossSaleValue = precisionRound(cnTotal.grossSaleValue + valueOfSale);
  cnTotal.totalTaxableProfit = precisionRound(
    cnTotal.totalTaxableProfit + taxableProfit
  );

  const fy = `fy${saleYear}`;

  if (!totals.total[fy]) {
    const priorFY = `fy${saleYear - 1}`;
    const prevTaxableProfit = totals.total[priorFY]?.taxableProfit;
    const taxableProfit = prevTaxableProfit < 0 ? prevTaxableProfit : 0;

    totals.total[fy] = {
      purchaseValue: 0,
      grossSaleValue: 0,
      totalProfit: 0,
      taxableProfit,
    };
  }

  const tt = totals.total[fy];

  tt.purchaseValue = precisionRound(tt.purchaseValue + valueOfBuy);
  tt.grossSaleValue = precisionRound(tt.grossSaleValue + valueOfSale);
  tt.totalProfit = precisionRound(tt.totalProfit + diff);
  tt.taxableProfit = precisionRound(tt.taxableProfit + taxableProfit);

  totals.taxSales.push(sellOrderHistory);

  const cnUnits = totals.units[sold.coin];
  totals.units[sold.coin] = precisionRound(cnUnits - Number(sellUnits));

  cb?.(sellOrderHistory);

  if (sold.unitsSold === sold.units) {
    return true; // break from buyData loop
  }

  return false;
};

// Avoid the JS float glitch
const precisionRound = (x: number) => {
  return Math.round(x * 10000000000) / 10000000000;
};

const monthDiff = (dateFrom: Date, dateTo: Date) => {
  return (
    dateTo.getMonth() -
    dateFrom.getMonth() +
    12 * (dateTo.getFullYear() - dateFrom.getFullYear())
  );
};

program();
