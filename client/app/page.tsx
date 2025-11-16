"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";

// ===== Bubble types =====
interface BubbleArtist {
  id: string; // Bubble internal ID
  id_text: string; // Spotify ID
  name_text: string;
  image_url_text: string;
  genre_list_text: string[];
}

interface BubbleConnectionRaw {
  id: string;
  [key: string]: any; // we don't know the fields yet – this is what we're debugging
}

// ===== Graph types =====
interface ArtistNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  image: string;
  genre: string;
}

export default function Home() {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    async function loadGraph() {
      try {
        // ============================
        // 1) FETCH ARTISTS
        // ============================
        console.log("Fetching Artists…");

        const resArtists = await fetch(
          "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/Artist?limit=500"
        );
        const jsonArtists = await resArtists.json();

        const artistsRaw: BubbleArtist[] = jsonArtists.response?.results || [];
        console.log("Received Artists:", artistsRaw.length);

        if (!artistsRaw.length) {
          console.warn("No artists returned – check Bubble privacy rules.");
          return;
        }

        // Map Bubble artist → node
        const nodesMap: Record<string, ArtistNode> = {};

        artistsRaw.forEach((a: BubbleArtist) => {
          const spotifyId = a.id_text || a.id; // fallback to Bubble ID
          if (!spotifyId) return;

          if (!nodesMap[spotifyId]) {
            nodesMap[spotifyId] = {
              id: spotifyId,
              name: a.name_text || "UNKNOWN",
              image: a.image_url_text || "",
              genre:
                Array.isArray(a.genre_list_text) && a.genre_list_text.length
                  ? a.genre_list_text.join(", ")
                  : "UNKNOWN",
            };
          }
        });

        const nodes: ArtistNode[] = Object.values(nodesMap);
        console.log("Unique Spotify artists (nodes):", nodes.length);

        // ============================
        // 2) FETCH ARTIST CONNECTIONS (DEBUG)
        // ============================
        console.log("Fetching ArtistConnections…");

        const resConnections = await fetch(
          "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/ArtistConnection?limit=500"
        );
        const jsonConnections = await resConnections.json();

        const connections: BubbleConnectionRaw[] =
          jsonConnections.response?.results || [];
        console.log("Received ArtistConnections:", connections.length);

        // 🔥 KEY DEBUG LINE:
        console.log("SAMPLE ARTISTCONNECTION RAW OBJECT:", connections[0]);

        // NOTE: For now we are NOT building links from connections.
        // This file is only to inspect what fields ArtistConnection actually has.
        // Once we see the structure in the console, we can wire up the real links.

        // ============================
        // 3) RENDER NODES ONLY (NO LINKS YET)
        // ============================

        const width = 1400;
        const height = 900;
        const baseRadius = 240; // 100% bigger than original 120

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
        svg.attr("width", width).attr("height", height).style("background", "#000");

        const g = svg.append("g");

        // Zoom / pan
        (svg as any).call(
          d3.zoom().scaleExtent([0.3, 3]).on("zoom", (event: any) => {
            g.attr("transform", event.transform);
          })
        );

        // Image defs
        const defs = svg.append("defs");
        nodes.forEach((n) => {
          const p = defs
            .append("pattern")
            .attr("id", `image-${n.id}`)
            .attr("patternUnits", "objectBoundingBox")
            .attr("width", 1)
            .attr("height", 1);

          p.append("image")
            .attr("href", n.image)
            .attr("width", baseRadius * 2)
            .attr("height", baseRadius * 2)
            .attr("preserveAspectRatio", "xMidYMid slice");
        });

        // Nodes
        const node = g
          .append("g")
          .selectAll("circle")
          .data(nodes)
          .enter()
          .append("circle")
          .attr("r", baseRadius)
          .attr("fill", (d) => `url(#image-${d.id})`)
          .attr("stroke", "#fff")
          .attr("stroke-width", 5);

        // Simple force layout to spread nodes
        d3
          .forceSimulation(nodes)
          .force("charge", d3.forceManyBody().strength(-1500))
          .force("collision", d3.forceCollide(baseRadius + 40))
          .force("center", d3.forceCenter(width / 2, height / 2))
          .on("tick", () => {
            node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);
          });
      } catch (e) {
        console.error("Error loading graph:", e);
      }
    }

    loadGraph();
  }, []);

  return (
    <div
      className="flex flex-col items-center min-h-screen bg-black text-white p-6"
      style={{ fontFamily: "Afacad, sans-serif" }}
    >
      <svg ref={svgRef}></svg>
    </div>
  );
}
