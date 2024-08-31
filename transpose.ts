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
 * TODO: Handling for Fund transfers?
 */

const transactionRefIdCoin = <Record<string, string>>{};

const program = () => {
  const rawData = fs.readFileSync("./data/" + dataFile).toString();
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

    const _id = Number(id);

    const actionMap = <Record<string, string>>{
      "Buy Order": "buy",
      "Sell Order": "sell",
      "Trading Fee": "fee",
      Withdraw: "withdraw", // Remove units from current total
      Deposit: "deposit", // Add units to current total
      // Reward: "reward", // Add units to current total
    };

    const action = actionMap[actionType];

    const isSell = action === "sell";
    const isBuy = action === "buy";
    const isFee = action === "fee";
    const isReward = action === "reward";
    const isWithdraw = action === "withdraw";
    const isDeposit = action === "deposit";

    if (
      !isWithdraw &&
      !isDeposit &&
      !isFee &&
      (recordType !== "Trade" || !action)
    ) {
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

    if (
      (coin === "aud" && !isFee) ||
      (!isWithdraw && !isDeposit && !unitPrice && action !== "fee")
    ) {
      continue;
    }

    if (isBuy || isSell) {
      transactionRefIdCoin[refId] = coin;
    }

    /**** Debug */
    // if (isFee) {
    //   process.stdout.write("-------\n");
    //   process.stdout.write(coin + "\n");
    //   process.stdout.write(recordType + "\n");
    //   process.stdout.write(String(isWithdraw) + "\n");
    //   process.stdout.write(String(unitPrice) + "\n");
    //   process.stdout.write(action + "\n");
    //   process.stdout.write(units + "\n");
    // }
    // continue;

    const record = <TransactionData>{
      date: new Date(dateStr),
      action,
      coin: isFee ? transactionRefIdCoin[refId] : coin,
      units: isFee ? null : units,
      unitPrice: isFee ? -parseFloat(amount) : unitPrice,
      refId,
    };

    if (!audit[coin]) {
      audit[coin] = {
        buy: 0,
        sell: 0,
        withdraw: 0,
        deposit: 0,
        active: 0,
      };
    }

    audit[coin][action] = prec(audit[coin][action] + units);
    audit[coin].active = prec(
      audit[coin].active + (isSell || isWithdraw ? -units : units)
    );

    pt.push(record);
  }

  /**** Debug */
  // console.log(audit);
  // process.exit();
  // return;

  saveSaleTransactions(pt);

  console.log("**** AUDIT TOTALS ****");
  console.log(audit);
};

const saveSaleTransactions = async (data: TransactionData[]) => {
  const secondaryAudit = <any>{};
  const csvOutput = [];

  for (const { date, action, coin, units, unitPrice, refId } of data) {
    csvOutput.push(
      `${date.toISOString()},${coin},${action},${units},${unitPrice},${refId}\n`
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

  const writeFile = "btc-processed-data.csv";
  fs.writeFileSync("./data/" + writeFile, csvOutput.join(""));
};

/**
 * Sell: Coin row contains "Fully matched" | "Partially matched"
 *  "Partially matched": Unit value comes from tail end 'at x.xx'
 *  "Fully matched" with no trailing "at x.xx": Take unit value from "@ AUD 555.00000000"
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
    case "buy":
    case "deposit": {
      if (!description.includes("Trade settled")) {
        return 0;
      }

      const [, unitPrice] = description.match(/@ AUD ([\d.]*)/) || [];
      return Number(unitPrice);
    }
    case "sell":
    case "withdraw": {
      const coin = extra.coin.toUpperCase();
      if (action === "sell" && !/(Fully|Partially) matched/.test(description)) {
        return 0;
      }

      const [, unitPriceAtEnd] = description.match(/matched at ([\d.]*)/) || [];
      if (Number(unitPriceAtEnd)) {
        return Number(unitPriceAtEnd);
      }

      const beginWithRegex = new RegExp(`@ AUD ([\\d.]*)`);
      const [, unitPriceAt] = description.match(beginWithRegex) || [];
      return Number(unitPriceAt);
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
