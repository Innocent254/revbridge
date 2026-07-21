import { describe, expect, it } from "vitest";
import {
  CLIENT_ACTIVITY,
  CLIENT_START_ACTION,
  buildStartActivityArgs,
  validateStartRequest,
} from "../src/main/controller";

const validRequest = {
  serial: "ABC123",
  dnsServers: "1.1.1.1,8.8.8.8",
  routes: "0.0.0.0/0",
  port: 31416,
  autoReconnect: true,
};

describe("tunnel request validation", () => {
  it("accepts a complete request", () => {
    expect(validateStartRequest(validRequest)).toEqual([]);
  });

  it("rejects missing values and invalid ports", () => {
    expect(
      validateStartRequest({
        ...validRequest,
        serial: " ",
        dnsServers: "",
        routes: "",
        port: 70_000,
      }),
    ).toEqual([
      "Choose an Android device.",
      "Port must be a whole number between 1 and 65535.",
      "At least one DNS server is required.",
      "At least one IPv4 route is required.",
    ]);
  });
});

describe("Android start command", () => {
  it("uses the independent RevBridge package and passes VPN settings", () => {
    expect(buildStartActivityArgs(validRequest)).toEqual([
      "shell",
      "am",
      "start",
      "-a",
      CLIENT_START_ACTION,
      "-n",
      CLIENT_ACTIVITY,
      "--esa",
      "dnsServers",
      "1.1.1.1,8.8.8.8",
      "--esa",
      "routes",
      "0.0.0.0/0",
    ]);
  });
});
