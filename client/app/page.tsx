"use client";
import { useEffect, useRef } from "react";
import * as d3 from "d3";

interface ArtistNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  image: string;
  genre: string;
}

interface ArtistLink extends d3.SimulationLinkDatum<ArtistNode> {
  source: string | ArtistNode;
  target: string | ArtistNode;
  strength: number;
}

export default function Home() {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        console.log("Fetching Artists...");

        const resArtists = await fetch(
          "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/Artist?limit=200"
        );
        const jsonArtists = await resArtists.json();

        const artistsRaw = jsonArtists.response?.results || [];
        console.log("Received Artists:", artistsRaw.length);

        // 🔥🔥🔥 NEW: DEBUG THIS TO FIX YOUR ISSUE
        console.log("SAMPLE ARTIST RAW OBJECT:", artistsRaw[0]);

        // STOP HERE — we cannot continue without knowing the ID field.
        // Rendering until ID is fixed:

        if (artistsRaw.length === 0) return;

        const wrapper = d3.select(svgRef.current);
        wrapper.selectAll("*").remove();

        wrapper
          .attr("width", 1400)
          .attr("height", 900)
          .style("background", "#000");

      } catch (err) {
        console.error("Error fetching artists:", err);
      }
    }

    fetchData();
  }, []);

  return (
    <div className="flex flex-col items-center min-h-screen bg-black text-white p-6">
      <svg ref={svgRef}></svg>
    </div>
  );
}
