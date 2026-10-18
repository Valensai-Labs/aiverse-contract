import { getAddress } from "ethers";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set in the .env file.`);
  }
  return value;
}

export function requireAddressEnv(name: string): string {
  return getAddress(requireEnv(name));
}

export function optionalAddressEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return getAddress(value && value.length > 0 ? value : fallback);
}
