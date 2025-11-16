"use client";

import { useEffect } from "react";

export default function DebugConnections() {
  useEffect(() => {
    async function testAPI() {
      try {
        console.log("Fetching ArtistConnection…");

        const res = await fetch(
          "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/ArtistConnection?limit=1"
        );

        const json = await res.json();

        const obj = json.response?.results?.[0];
        console.log("RAW CONNECTION:", obj);

        if (!obj) {
          console.warn("⚠️ No ArtistConnection records returned.");
          return;
        }

        console.log("============ FIELD INSPECTION ============");

        Object.entries(obj).forEach(([key, value]) => {
          console.log(`FIELD: "${key}"  →  VALUE:`, value);
          console.log(`TYPE OF VALUE:`, typeof value);
          console.log("----------------------------------------");
        });

        console.log("============ END OF INSPECTION ============");
      } catch (e) {
        console.error("API ERROR:", e);
      }
    }

    testAPI();
  }, []);

  return (
    <div
      className="min-h-screen bg-black text-white p-10"
      style={{ fontFamily: "Afacad, sans-serif" }}
    >
      <h1 className="text-3xl font-bold mb-4">Inspecting ArtistConnection API…</h1>
      <p className="text-lg opacity-80">Open your browser console to see detailed output.</p>
    </div>
  );
}
