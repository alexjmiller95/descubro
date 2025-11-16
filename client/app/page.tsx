"use client";

import { useEffect } from "react";

export default function DebugConnections() {
  useEffect(() => {
    async function testAPI() {
      const res = await fetch(
        "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/ArtistConnection?limit=1"
      );
      const json = await res.json();

      console.log("RAW CONNECTION:", json.response?.results?.[0]);
      console.log("FIELDS:", Object.keys(json.response?.results?.[0] || {}));
    }

    testAPI();
  }, []);

  return (
    <div className="text-white p-10 bg-black min-h-screen">
      <h1>Checking ArtistConnection API…</h1>
      <p>Open console to see results.</p>
    </div>
  );
}
