import { describe, expect, it } from "vitest";
import { parseAdbDevices } from "../src/main/services/adb";

describe("parseAdbDevices", () => {
  it("parses authorized devices and their metadata", () => {
    const output = `List of devices attached
R58M123456A\tdevice product:a54x model:SM_A546E device:a54x transport_id:2
emulator-5554 device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:3
`;

    expect(parseAdbDevices(output)).toEqual([
      {
        serial: "R58M123456A",
        state: "device",
        product: "a54x",
        model: "SM A546E",
        device: "a54x",
        transportId: "2",
      },
      {
        serial: "emulator-5554",
        state: "device",
        product: "sdk_gphone64_x86_64",
        model: "sdk gphone64 x86 64",
        device: "emu64xa",
        transportId: "3",
      },
    ]);
  });

  it("keeps unauthorized, offline, and Linux permission failures visible", () => {
    const output = `List of devices attached
ABC123 unauthorized usb:1-2 transport_id:1
DEF456 offline transport_id:2
???????????? no permissions (user in plugdev group; are your udev rules wrong?)
`;

    expect(parseAdbDevices(output).map(({ serial, state }) => ({ serial, state }))).toEqual([
      { serial: "ABC123", state: "unauthorized" },
      { serial: "DEF456", state: "offline" },
      { serial: "????????????", state: "no-permissions" },
    ]);
  });

  it("ignores daemon noise and malformed lines", () => {
    const output = `* daemon not running; starting now at tcp:5037
* daemon started successfully
List of devices attached
garbage
`;
    expect(parseAdbDevices(output)).toEqual([]);
  });
});
