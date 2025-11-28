import type {
  HyperstreamClientInterface,
  HyperstreamClientConfig,
} from "./types";
import { HyperstreamClient } from "./client";

export * from "./types";
export * from "./errors";
export * from "./fetch";
export { HyperstreamClient };

export function createHyperstreamClient(
  config: HyperstreamClientConfig
): HyperstreamClientInterface {
  return new HyperstreamClient(config);
}
