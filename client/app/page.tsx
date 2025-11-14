"use client";
import { useEffect, useRef } from "react";
import * as d3 from "d3";

interface ArtistNode extends d3.SimulationNodeDatum {
  id: string;       // now Spotify ID
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
        console.log("Fetching artist connections...");
        const res = await fetch(
          "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/ArtistConnection?limit=500"
        );
        const json = await res.json();
        const connections = json.response.results || [];
        if (!connections.length) return;

        console.log("Connections:", connections.length);

        // -----------------------------------------------------
        // 💡 STEP 1 — Collect all Bubble Artist IDs from connections
        // -----------------------------------------------------
        const bubbleArtistIds = [
          ...connections.map((c: any) => c.artist_11_custom_artist),
          ...connections.map((c: any) => c.artist_21_custom_artist),
        ].filter(Boolean);

        // -----------------------------------------------------
        // 💡 STEP 2 — Fetch artists & merge them by Spotify ID
        // -----------------------------------------------------
        const artistMapBySpotify: Record<string, ArtistNode> = {};
        const bubbleIdToSpotify: Record<string, string> = {};

        for (const bubbleId of bubbleArtistIds) {
          const result = await fetch(
            `https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/Artist/${bubbleId}`
          );
          const data = await result.json();
          const a = data.response;
          if (!a) continue;

          const spotifyId = a.spotify_id_text;
          if (!spotifyId) continue;

          bubbleIdToSpotify[bubbleId] = spotifyId;

          // If first time seeing this Spotify artist, store it
          if (!artistMapBySpotify[spotifyId]) {
            artistMapBySpotify[spotifyId] = {
              id: spotifyId,
              name: a.name_text || "Unknown",
              image: a.image_url_text || "",
              genre: Array.isArray(a.genre_list_text)
                ? a.genre_list_text.join(", ")
                : a.genre_list_text || "Unknown",
            };
          }
        }

        const nodes: ArtistNode[] = Object.values(artistMapBySpotify);
        console.log("Unique artists (Spotify):", nodes.length);

        // -----------------------------------------------------
        // 💡 STEP 3 — Build links using Spotify IDs
        // -----------------------------------------------------
        const links: ArtistLink[] = connections
          .map((c: any) => {
            const s = bubbleIdToSpotify[c.artist_11_custom_artist];
            const t = bubbleIdToSpotify[c.artist_21_custom_artist];

            return {
              source: s,
              target: t,
              strength: c.connection_strength_number || 1,
            };
          })
          .filter(
            (l) =>
              l.source &&
              l.target &&
              artistMapBySpotify[l.source] &&
              artistMapBySpotify[l.target]
          );

        console.log("Valid links:", links.length);

        // -----------------------------------------------------
        // Layout & graph rendering below (unchanged)
        // -----------------------------------------------------
        const connectionCount: Record<string, number> = {};
        links.forEach((l) => {
          const s = typeof l.source === "string" ? l.source : l.source.id;
          const t = typeof l.target === "string" ? l.target : l.target.id;
          connectionCount[s] = (connectionCount[s] || 0) + 1;
          connectionCount[t] = (connectionCount[t] || 0) + 1;
        });

        const width = 1400;
        const height = 900;
        const baseRadius = 120;
        const highlightScale = 1.1;
        const colorScale = d3.scaleOrdinal(d3.schemeTableau10);

        const genreColorMap: Record<string, string> = {};
        nodes.forEach((n) => {
          const g = n.genre.split(",")[0].trim();
          if (!genreColorMap[g]) genreColorMap[g] = colorScale(g) as string;
        });

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
        svg.attr("width", width).attr("height", height).style("background", "#0b0b0b");

        const g = svg.append("g");
        (svg as any).call(
          d3
            .zoom()
            .scaleExtent([0.3, 3])
            .on("zoom", (event: any) => g.attr("transform", event.transform))
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

        // Draw links
        const link = g
          .append("g")
          .selectAll("line")
          .data(links)
          .enter()
          .append("line")
          .attr("stroke", (d) => {
            const src = typeof d.source === "string" ? d.source : d.source.id;
            const srcGenre = artistMapBySpotify[src]?.genre.split(",")[0].trim();
            return genreColorMap[srcGenre] || "#00aaff";
          })
          .attr("stroke-width", 4)
          .attr("stroke-opacity", 0.8);

        // Draw nodes
        const node = g
          .append("g")
          .selectAll("circle")
          .data(nodes)
          .enter()
          .append("circle")
          .attr("r", baseRadius)
          .attr("fill", (d) => `url(#image-${d.id})`)
          .attr("stroke", (d) => genreColorMap[d.genre.split(",")[0].trim()])
          .attr("stroke-width", 5)
          .style("cursor", "pointer");

        // Genres layout
        const genres = Array.from(new Set(nodes.map((n) => n.genre.split(",")[0].trim())));
        const genrePositions: Record<string, [number, number]> = {};
        const stepX = width / (genres.length + 1);

        genres.forEach((gname, i) => {
          genrePositions[gname] = [stepX * (i + 1), height / 2];
        });

        const simulation = d3
          .forceSimulation(nodes)
          .force(
            "link",
            d3
              .forceLink(links)
              .id((d) => (d as ArtistNode).id)
              .distance(900)
          )
          .force("charge", d3.forceManyBody().strength(-1000))
          .force("collision", d3.forceCollide(baseRadius + 80))
          .force(
            "x",
            d3
              .forceX((d) => genrePositions[(d as ArtistNode).genre.split(",")[0].trim()]?.[0])
              .strength(0.4)
          )
          .force(
            "y",
            d3
              .forceY((d) => genrePositions[(d as ArtistNode).genre.split(",")[0].trim()]?.[1])
              .strength(0.4)
          )
          .on("tick", () => {
            link
              .attr("x1", (d) => (d.source as ArtistNode).x || 0)
              .attr("y1", (d) => (d.source as ArtistNode).y || 0)
              .attr("x2", (d) => (d.target as ArtistNode).x || 0)
              .attr("y2", (d) => (d.target as ArtistNode).y || 0);

            node
              .attr("cx", (d) => (d as ArtistNode).x || 0)
              .attr("cy", (d) => (d as ArtistNode).y || 0);
          })
          .on("end", () => {
            simulation.stop();
            nodes.forEach((n) => {
              n.fx = n.x;
              n.fy = n.y;
            });
          });

        // Tooltip
        const tooltip = d3
          .select("body")
          .append("div")
          .style("position", "absolute")
          .style("background", "rgba(20,20,20,0.9)")
          .style("color", "#fff")
          .style("padding", "10px 12px")
          .style("border-radius", "8px")
          .style("font-size", "13px")
          .style("opacity", 0)
          .style("pointer-events", "none");

        function showTooltip(event: any, d: ArtistNode) {
          tooltip
            .html(
              `<strong>${d.name}</strong><br>
               GENRE: ${d.genre}<br>
               CONNECTIONS: ${connectionCount[d.id] || 0}`
            )
            .style("opacity", 1)
            .style("left", event.pageX + 15 + "px")
            .style("top", event.pageY - 35 + "px");
        }

        node
          .on("mouseover", showTooltip)
          .on("mousemove", showTooltip)
          .on("mouseout", () => tooltip.style("opacity", 0));

      } catch (err) {
        console.error("Error:", err);
      }
    }

    fetchData();
  }, []);

  return (
    <div className="flex flex-col items-center min-h-screen bg-black text-white p-6 space-y-4 relative">
      <svg ref={svgRef}></svg>
    </div>
  );
}
