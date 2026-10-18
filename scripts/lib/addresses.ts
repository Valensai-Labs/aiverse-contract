import * as fs from "fs";
import * as path from "path";

export type AddressBook = Record<string, Record<string, string>>;

function deploymentPath(network: string): string {
  return path.join(__dirname, "../deployments", `${network}.json`);
}

export function readBook(network: string): AddressBook {
  const file = deploymentPath(network);
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8")) as AddressBook;
}

export function writeBook(network: string, book: AddressBook): void {
  const file = deploymentPath(network);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(book, null, 2)}\n`);
}

export function putAddress(
  network: string,
  contractId: string,
  key: string,
  value: string
): void {
  const book = readBook(network);
  const row = book[contractId] ?? {};
  row[key] = value;
  book[contractId] = row;
  writeBook(network, book);
  console.log(`Recorded deployments/${network}.json ${contractId}.${key}=${value}`);
}

export function fillAddress(
  network: string,
  contractId: string,
  key: string,
  value: string
): void {
  const book = readBook(network);
  const row = book[contractId] ?? {};
  if (row[key]) return;
  row[key] = value;
  book[contractId] = row;
  writeBook(network, book);
  console.log(`Recorded deployments/${network}.json ${contractId}.${key}=${value}`);
}
