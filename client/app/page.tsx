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

interface BubbleArtist {
  name: string;
  artist_id: string;
  spotify_id: string;
  genre: string;
  image_url: string;
  connections: string[];
}

export default function Home() {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        console.log("Fetching Artists...");

        const resArtists = await fetch(
          "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/Artist?limit=500"
        );
        const jsonArtists = await resArtists.json();

        const artistsRaw: BubbleArtist[] = jsonArtists.response?.results || [];
        console.log("Received Artists:", artistsRaw.length);

        if (artistsRaw.length === 0) {
          console.warn("❌ No artists found — check Bubble privacy rules");
          return;
        }

        const artistMapBySpotify: Record<string, ArtistNode> = {};

        // ⭐ FIXED: typed "a"
        artistsRaw.forEach((a: BubbleArtist) => {
          const spotifyId = a.spotify_id || a.artist_id;
          if (!spotifyId) return;

          if (!artistMapBySpotify[spotifyId]) {
            artistMapBySpotify[spotifyId] = {
              id: spotifyId,
              name: a.name || "Unknown",
              image: a.image_url || "",
              genre: a.genre || "Unknown",
            };
          }
        });

        const nodes: ArtistNode[] = Object.values(artistMapBySpotify);
        console.log("Unique Spotify artists (nodes):", nodes.length);

        if (nodes.length === 0) return;

        let rawLinks: ArtistLink[] = [];

        // ⭐ FIXED: typed "a"
        artistsRaw.forEach((a: BubbleArtist) => {
          const spotifyId = a.spotify_id || a.artist_id;
          if (!spotifyId) return;

          if (Array.isArray(a.connections)) {
            a.connections.forEach((connectedSpotifyId: string) => {
              if (
                connectedSpotifyId &&
                connectedSpotifyId !== spotifyId &&
                artistMapBySpotify[connectedSpotifyId]
              ) {
                rawLinks.push({
                  source: spotifyId,
                  target: connectedSpotifyId,
                  strength: 1,
                });
              }
            });
          }
        });

        const linkMap = new Map<string, ArtistLink>();
        rawLinks.forEach((l) => {
          const s = typeof l.source === "string" ? l.source : l.source.id;
          const t = typeof l.target === "string" ? l.target : l.target.id;
          const key = s < t ? `${s}__${t}` : `${t}__${s}`;
          if (!linkMap.has(key)) linkMap.set(key, l);
        });

        const links: ArtistLink[] = Array.from(linkMap.values());
        console.log("Valid unique links:", links.length);

        const width = 1400;
        const height = 900;
        const baseRadius = 120;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
        svg.attr("width", width).attr("height", height).style("background", "#0b0b0b");

        const g = svg.append("g");

        (svg as any).call(
          d3.zoom().scaleExtent([0.3, 3]).on("zoom", (event) => g.attr("transform", event.transform))
        );

        const defs = svg.append("defs");
        nodes.forEach((n) => {
          const pattern = defs
            .append("pattern")
            .attr("id", `image-${n.id}`)
            .attr("patternUnits", "objectBoundingBox")
            .attr("width", 1)
            .attr("height", 1);

          pattern
            .append("image")
            .attr("href", n.image)
            .attr("width", baseRadius * 2)
            .attr("height", baseRadius * 2)
            .attr("preserveAspectRatio", "xMidYMid slice");
        });

        const link = g
          .append("g")
          .selectAll("line")
          .data(links)
          .enter()
          .append("line")
          .attr("stroke", "#888")
          .attr("stroke-opacity", 0.6)
          .attr("stroke-width", 3);

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

        const simulation = d3
          .forceSimulation(nodes)
          .force("link", d3.forceLink(links).id((d: any) => d.id).distance(900))
          .force("charge", d3.forceManyBody().strength(-1000))
          .force("collision", d3.forceCollide(baseRadius + 80))
          .on("tick", () => {
            link
              .attr("x1", (d: any) => d.source.x)
              .attr("y1", (d: any) => d.source.y)
              .attr("x2", (d: any) => d.target.x)
              .attr("y2", (d: any) => d.target.y);

            node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);
          });
      } catch (err) {
        console.error("Error building graph:", err);
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
