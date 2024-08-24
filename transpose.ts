import fs from "node:fs";

const [csvFilename] = process.argv.slice(2);
const dataFile = csvFilename || "crypto-export.csv";

interface TransactionData {
  date: Date;
  action: "buy" | "sell";
  coin: string;
  units: number;
  unitPrice: number;
  fee: number;
  refId: string;
}

/**
 * Basic reformatting script for BTC Markets transaction export
 * TODO: Include transactional fees
 */

const program = () => {
  const rawData = fs.readFileSync(dataFile).toString();
  const rows = rawData.split(/\n/g);

  const processedTransactions = <TransactionData[]>[];
  const pt = processedTransactions;

  const audit = <any>{};

  for (const row of rows) {
    if (!row) continue;

    const [
      id,
      dateStr,
      recordType,
      actionType,
      currency,
      amount,
      description,
      balance,
      refId,
    ] = row.split(",");

    const actionMap = <Record<string, string>>{
      "Buy Order": "buy",
      "Sell Order": "sell",
      // "Trading Fee": "fee",
      Withdraw: "withdraw",
    };

    const action = actionMap[actionType];

    const isSell = action === "sell";
    const isWithdraw = action === "withdraw";

    if (!isWithdraw && (recordType !== "Trade" || !action)) {
      continue;
    }

    const coin = currency.toLowerCase();
    const units = isSell || isWithdraw ? -Number(amount) : Number(amount);
    const unitPrice =
      getUnitPrice(action, description, {
        units,
        coin,
        balance,
      }) || null;

    if (coin === "aud" || (!isWithdraw && !unitPrice && action !== "fee")) {
      continue;
    }

    const record = <TransactionData>{
      date: new Date(dateStr),
      action,
      coin,
      units,
      unitPrice,
      refId,
    };

    if (!audit[coin]) {
      audit[coin] = {
        buy: 0,
        sell: 0,
        withdraw: 0,
        active: 0,
      };
    }

    audit[coin][action] = prec(audit[coin][action] + units);
    audit[coin].active = prec(
      audit[coin].active + (isSell || isWithdraw ? -units : units)
    );

    pt.push(record);
  }

  const secondaryAudit = <any>{};
  const csvOutput = [];

  for (const { date, action, coin, units, unitPrice } of pt) {
    csvOutput.push(
      `${date.toISOString()},${coin},${action},${units},${unitPrice}\n`
    );

    if (!secondaryAudit[coin]) {
      secondaryAudit[coin] = {
        total: 0,
      };
    }

    const isSell = action === "sell";
    secondaryAudit[coin].total = prec(
      secondaryAudit[coin].total + (isSell ? -units : units)
    );
  }

  const writeFile = "btc-data.csv";
  fs.writeFileSync(writeFile, csvOutput.join(""));

  console.log("**** AUDIT TOTALS ****");
  console.log(audit);
};

/**
 * Sell: Coin row contains "Fully matched" | "Partially matched"
 *  Unit value comes from tail end 'at x.xx'
 * Buy: Coin row contains "Trade settled"
 *  Unit value comes from '@ AUD x.xx'
 */
const auditDescription = { eth: 0 };
const getUnitPrice = (
  action: string,
  description: string,
  extra: any
): number => {
  switch (action) {
    case "buy": {
      if (!description.includes("Trade settled")) {
        return 0;
      }

      const [, unitPrice] = description.match(/@ AUD ([\d.]*)/) || [];
      return Number(unitPrice);
    }
    case "sell":
    case "withdraw": {
      if (action === "sell" && !/(Fully|Partially) matched/.test(description)) {
        return 0;
      }

      const [, unitPrice] = description.match(/matched at ([\d.]*)/) || [];
      return Number(unitPrice);
    }
  }

  return 0;
};

// Avoid the JS float glitch
const prec = (x: number) => {
  return Math.round(x * 1e10) / 1e10;
};

const precCurrency = (x: number) => {
  return Math.floor(x * 1e8) / 1e8;
};

program();
