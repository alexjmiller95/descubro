"use client";
import { useEffect, useRef } from "react";
import * as d3 from "d3";

// ============================
// Types
// ============================

interface BubbleArtist {
  id: string; // Bubble internal ID
  id_text: string; // Spotify ID
  name_text: string;
  image_url_text: string;
  genre_list_text: string[];
}

interface BubbleConnection {
  artist_1_custom_artist: string; // Bubble Artist ID
  artist_2_custom_artist: string; // Bubble Artist ID
  connection_strength_number: number;
}

interface ArtistNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  image: string;
  genre: string;
}

interface ArtistLink extends d3.SimulationLinkDatum<ArtistNode> {
  source: string;
  target: string;
  strength: number;
}

export default function Home() {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    async function loadGraph() {
      try {
        // ============================
        // 1) FETCH ALL ARTISTS
        // ============================
        console.log("Fetching Artists…");

        const resArtists = await fetch(
          "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/Artist?limit=500"
        );
        const jsonArtists = await resArtists.json();

        const artistsRaw: BubbleArtist[] = jsonArtists.response?.results || [];
        console.log("Received Artists:", artistsRaw.length);

        if (artistsRaw.length === 0) return;

        // Build lookup: BubbleID → SpotifyID
        const bubbleToSpotify: Record<string, string> = {};
        const spotifyToArtist: Record<string, ArtistNode> = {};

        artistsRaw.forEach((a) => {
          const bubbleId = a.id;
          const spotifyId = a.id_text ?? bubbleId;

          bubbleToSpotify[bubbleId] = spotifyId;

          if (!spotifyToArtist[spotifyId]) {
            spotifyToArtist[spotifyId] = {
              id: spotifyId,
              name: a.name_text || "Unknown",
              image: a.image_url_text || "",
              genre:
                Array.isArray(a.genre_list_text)
                  ? a.genre_list_text.join(", ")
                  : "Unknown",
            };
          }
        });

        const nodes: ArtistNode[] = Object.values(spotifyToArtist);
        console.log("Unique Spotify artists (nodes):", nodes.length);

        // ============================
        // 2) FETCH CONNECTIONS
        // ============================
        console.log("Fetching ArtistConnections…");

        const resConnections = await fetch(
          "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/ArtistConnection?limit=500"
        );
        const jsonConnections = await resConnections.json();

        const connections: BubbleConnection[] =
          jsonConnections.response?.results || [];

        console.log("Received ArtistConnections:", connections.length);

        // ============================
        // 3) BUILD LINKS
        // ============================
        let rawLinks: ArtistLink[] = [];

        connections.forEach((c) => {
          const b1 = c.artist_1_custom_artist;
          const b2 = c.artist_2_custom_artist;

          if (!b1 || !b2) return;

          const s = bubbleToSpotify[b1];
          const t = bubbleToSpotify[b2];

          if (!s || !t || s === t) return;
          if (!spotifyToArtist[s] || !spotifyToArtist[t]) return;

          rawLinks.push({
            source: s,
            target: t,
            strength: c.connection_strength_number ?? 1,
          });
        });

        // Deduplicate links
        const linkMap = new Map<string, ArtistLink>();
        rawLinks.forEach((l) => {
          const key = l.source < l.target ? `${l.source}__${l.target}` : `${l.target}__${l.source}`;
          if (!linkMap.has(key)) linkMap.set(key, l);
        });

        const links = Array.from(linkMap.values());
        console.log("Unique links:", links.length);

        // ============================
        // 4) RENDER THE GRAPH
        // ============================

        const width = 1400;
        const height = 900;
        const baseRadius = 120;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
        svg.attr("width", width).attr("height", height).style("background", "#000");

        const g = svg.append("g");

        // Zoom
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

        // Links
        const link = g
          .append("g")
          .selectAll("line")
          .data(links)
          .enter()
          .append("line")
          .attr("stroke", "#666")
          .attr("stroke-width", 3)
          .attr("stroke-opacity", 0.7);

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

        // Simulation
        const simulation = d3
          .forceSimulation(nodes)
          .force("link", d3.forceLink(links).id((d: any) => d.id).distance(900))
          .force("charge", d3.forceManyBody().strength(-1200))
          .force("collision", d3.forceCollide(baseRadius + 80))
          .on("tick", () => {
            link
              .attr("x1", (d: any) => d.source.x)
              .attr("y1", (d: any) => d.source.y)
              .attr("x2", (d: any) => d.target.x)
              .attr("y2", (d: any) => d.target.y);

            node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);
          });
      } catch (e) {
        console.error(e);
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
