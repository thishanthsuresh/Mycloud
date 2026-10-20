export function getClientDeviceId() {
  const existing = window.localStorage.getItem("mycloud.security.deviceId");
  if (existing) return existing;
  const generated = crypto.randomUUID();
  window.localStorage.setItem("mycloud.security.deviceId", generated);
  return generated;
}

export function getDeviceName(userAgent: string) {
  const operatingSystem = /Android/i.test(userAgent) ? "Android"
    : /iPhone|iPad|iPod/i.test(userAgent) ? "iOS"
      : /Windows/i.test(userAgent) ? "Windows"
        : /Mac OS/i.test(userAgent) ? "macOS"
          : /Linux/i.test(userAgent) ? "Linux"
            : "Unknown device";
  const browser = /Edg\//i.test(userAgent) ? "Edge"
    : /Firefox\//i.test(userAgent) ? "Firefox"
      : /Chrome\//i.test(userAgent) ? "Chrome"
        : /Safari\//i.test(userAgent) ? "Safari"
          : "Browser";
  return `${browser} on ${operatingSystem}`;
}
