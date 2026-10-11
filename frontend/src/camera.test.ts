import { describe, expect, it } from "vitest";
import { cameraName, isUsbCamera, rankCameras } from "./components/CameraFeed";

// The three cameras seen on this PC.
const cams = ["ACER HD User Facing (0408:403d)", "e2eSoft iVCam", "HD Pro Webcam C920 (046d:082d)"].map(
  (label, i) => ({ deviceId: String(i), label, kind: "videoinput", groupId: "" }) as MediaDeviceInfo,
);

describe("câmera USB da pista", () => {
  it("escolhe a webcam USB, não a do notebook nem a virtual", () => {
    expect(rankCameras(cams)[0].label).toContain("C920");
    expect(isUsbCamera(cams[2].label)).toBe(true);
    expect(isUsbCamera(cams[0].label)).toBe(false); // built into the notebook
    expect(isUsbCamera(cams[1].label)).toBe(false); // virtual (phone app)
  });
  it("mostra o nome sem o código do fabricante", () => {
    expect(cameraName("HD Pro Webcam C920 (046d:082d)")).toBe("HD Pro Webcam C920");
  });
});
