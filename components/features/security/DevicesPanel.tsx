"use client";

import { useCallback, useEffect, useState } from "react";
import { getClientDeviceId } from "@/lib/security/device";

type SecurityDevice = {
  id: string;
  client_device_id: string;
  device_name: string;
  first_seen_at: string;
  last_seen_at: string;
};

export default function DevicesPanel() {
  const [devices, setDevices] = useState<SecurityDevice[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const clientDeviceId = getClientDeviceId();
      const registrationResponse = await fetch("/api/security/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientDeviceId }),
      });
      const registrationResult = await registrationResponse.json() as { error?: string };
      if (!registrationResponse.ok) {
        throw new Error(registrationResult.error ?? "Could not register this device.");
      }

      const response = await fetch("/api/security/devices");
      const result = await response.json() as { devices?: SecurityDevice[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not load signed-in devices.");
      setDevices(result.devices ?? []);
      setCurrentDeviceId(clientDeviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load signed-in devices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDevices(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDevices]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-semibold text-slate-900">Signed-in devices</h2>
        <p className="mt-1 text-sm text-slate-500">Devices are recorded when you sign in on this browser profile. Times are shown in your local timezone.</p>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {loading ? <p className="py-8 text-center text-sm text-slate-500">Loading devices…</p> : devices.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No device sign-ins are recorded yet. Sign out and back in to register this device.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {devices.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  {device.device_name} {device.client_device_id === currentDeviceId && <span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">This device</span>}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  First sign-in: {new Date(device.first_seen_at).toLocaleString()}
                </p>
              </div>
              <p className="text-xs text-slate-600">Last sign-in: {new Date(device.last_seen_at).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => void loadDevices()} disabled={loading} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        Refresh devices
      </button>
    </section>
  );
}
