import fs from "node:fs";

type Action = "buy" | "sell";

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
  perCoin: <any>{},
  taxSales: <any>[],
  total: <Record<string, any>>{},
};

/**
 * Sales are calculated against the earliest unsold purchase
 *  for tax purposes. Sales of assets held longer than
 *  12 months are taxed at 50% (CGT discount). Taxable losses
 *  roll into the following year(s).
 */

const program = () => {
  process.stdout.write(
    "**** NOTICE ****\nOnly supports up to 10 decimal places, calculations with smaller units will fail inextricably.\n\n"
  );

  const rawData = fs.readFileSync("./crypto-data.csv").toString();
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

    const updateObject = action === "buy" ? buyData : sellData;
    updateObject.push(addData);
  }

  for (const sold of sellData) {
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

  console.log("*** Transactional Tax Calculations ***");
  console.log(totals.taxSales);
  console.log("*** Totals ***");
  console.log(totals.total);
};

const compareAndUpdateBought = (bought: Data, sold: Data) => {
  const boughtUnitsToSell = bought.units - precisionRound(bought.unitsSold);
  const unitsSelling = sold.units - precisionRound(sold.unitsSold);

  const sellUnits = precisionRound(
    unitsSelling > boughtUnitsToSell ? boughtUnitsToSell : unitsSelling
  );

  const valueOrBuy = precisionRound(sellUnits * bought.unitPrice);
  const valueOfSale = precisionRound(sellUnits * sold.unitPrice);

  const diff = precisionRound(valueOfSale - valueOrBuy);
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
    purchaseValue: precisionRound(sellUnits * bought.unitPrice),
    purchaseUnitPrice: bought.unitPrice,
    saleValue: valueOfSale,
    unitsSold: sellUnits,
    saleUnitPrice: sold.unitPrice,
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
    cnTotal.totalPurchaseValue + valueOrBuy
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

  tt.purchaseValue = precisionRound(tt.purchaseValue + valueOrBuy);
  tt.grossSaleValue = precisionRound(tt.grossSaleValue + valueOfSale);
  tt.totalProfit = precisionRound(tt.totalProfit + diff);
  tt.taxableProfit = precisionRound(tt.taxableProfit + taxableProfit);

  totals.taxSales.push(sellOrderHistory);

  if (sold.unitsSold === sold.units) {
    return true; // break from buyData loop
  }

  return false;
};

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
