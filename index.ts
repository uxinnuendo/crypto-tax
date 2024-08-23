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
  total: {
    purchaseValue: 0,
    grossSaleValue: 0,
    totalProfit: 0,
    taxableProfit: 0,
  },
};

/**
 * Sales are calculated against the earliest purchase
 *  for tax purposes. Sales of assets held longer than
 *  12 months are taxed at 50% (CGT discount).
 */

const program = () => {
  process.stdout.write("**** NOTICE ****\n");
  process.stdout.write(
    "Only supports up to 10 decimal places, calculations with smaller units will fail inextricably.\n"
  );
  process.stdout.write("\n");

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
        (!!bought.unitsSold && bought.unitsSold === bought.units)
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

  totals.total.purchaseValue = precisionRound(
    totals.total.purchaseValue + valueOrBuy
  );
  totals.total.grossSaleValue = precisionRound(
    totals.total.grossSaleValue + valueOfSale
  );
  totals.total.totalProfit = precisionRound(totals.total.totalProfit + diff);
  totals.total.taxableProfit = precisionRound(
    totals.total.taxableProfit + taxableProfit
  );

  totals.taxSales.push(sellOrderHistory);

  if (sold.unitsSold === sold.units) {
    return true; // break from buy data loop
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
