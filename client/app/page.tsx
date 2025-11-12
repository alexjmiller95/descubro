"use client";
import { useEffect, useRef } from "react";
import * as d3 from "d3";

interface ArtistNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  image: string;
  genre: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
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
        const res = await fetch(
          "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/ArtistConnection"
        );
        const json = await res.json();
        const connections = json.response.results;

        if (!connections?.length) return console.warn("No artist connections found.");

        const uniqueArtistIds = Array.from(
          new Set([
            ...connections.map((c: any) => c.artist_11_custom_artist),
            ...connections.map((c: any) => c.artist_21_custom_artist),
          ])
        ).filter(Boolean);

        const artistMap: Record<string, ArtistNode> = {};
        for (const artistId of uniqueArtistIds) {
          try {
            const res = await fetch(
              `https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/Artist/${artistId}`
            );
            const json = await res.json();
            const a = json.response;

            artistMap[artistId] = {
              id: artistId,
              name: a.name_text || "Unknown",
              image: a.image_url_text || "",
              genre: Array.isArray(a.genre_list_text)
                ? a.genre_list_text[0] || "Unknown"
                : a.genre_list_text || "Unknown",
            };
          } catch (err) {
            console.error(`Error fetching artist ${artistId}:`, err);
          }
        }

        const nodes: ArtistNode[] = Object.values(artistMap);
        const links: ArtistLink[] = connections
          .map((c: any) => ({
            source: c.artist_11_custom_artist,
            target: c.artist_21_custom_artist,
            strength: c.connection_strength_number || 1,
          }))
          .filter(
            (l: ArtistLink) =>
              artistMap[l.source as string] && artistMap[l.target as string]
          );

        const connectionCount: Record<string, number> = {};
        links.forEach((l) => {
          const s = typeof l.source === "string" ? l.source : l.source.id;
          const t = typeof l.target === "string" ? l.target : l.target.id;
          connectionCount[s] = (connectionCount[s] || 0) + 1;
          connectionCount[t] = (connectionCount[t] || 0) + 1;
        });

        const maxConnections = Math.max(...Object.values(connectionCount));
        const radiusScale = d3.scaleSqrt().domain([1, maxConnections]).range([30, 70]);
        const colorScale = d3.scaleOrdinal(d3.schemeTableau10);

        const width = 1200;
        const height = 800;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
        svg
          .attr("width", width)
          .attr("height", height)
          .style("background", "#0b0b0b");

        const g = svg.append("g");

        (svg as any).call(
          d3
            .zoom()
            .scaleExtent([0.3, 4])
            .on("zoom", (event: any) => g.attr("transform", event.transform))
        );

        const defs = svg.append("defs");
        nodes.forEach((n) => {
          if (n.image) {
            const pattern = defs
              .append("pattern")
              .attr("id", `image-${n.id}`)
              .attr("patternUnits", "objectBoundingBox")
              .attr("width", 1)
              .attr("height", 1);
            pattern
              .append("image")
              .attr("href", n.image)
              .attr("width", 150)
              .attr("height", 150)
              .attr("preserveAspectRatio", "xMidYMid slice");
          }
        });

        const genreColorMap: Record<string, string> = {};
        nodes.forEach((n) => {
          if (!genreColorMap[n.genre]) {
            genreColorMap[n.genre] = colorScale(n.genre) as string;
          }
        });

        const link = g
          .append("g")
          .selectAll("line")
          .data(links)
          .enter()
          .append("line")
          .attr("stroke", (d) => {
            const src = typeof d.source === "string" ? d.source : d.source.id;
            const srcGenre = artistMap[src]?.genre;
            return genreColorMap[srcGenre] || "#00aaff";
          })
          .attr("stroke-opacity", 0.8)
          .attr("stroke-width", (d) => Math.sqrt(d.strength) * 2);

        const node = g
          .append("g")
          .selectAll("circle")
          .data(nodes)
          .enter()
          .append("circle")
          .attr("r", (d) => radiusScale(connectionCount[d.id] || 1))
          .attr("fill", (d) => (d.image ? `url(#image-${d.id})` : "#ff6666"))
          .attr("stroke", (d) => genreColorMap[d.genre])
          .attr("stroke-width", 4)
          .style("cursor", "pointer");

        // 🧠 Genre clustering
        const genres = Array.from(new Set(nodes.map((n) => n.genre)));
        const genrePositions: Record<string, [number, number]> = {};
        const stepX = width / (Math.ceil(Math.sqrt(genres.length)) + 1);
        const stepY = height / (Math.ceil(Math.sqrt(genres.length)) + 1);
        genres.forEach((gname, i) => {
          const col = i % Math.ceil(Math.sqrt(genres.length));
          const row = Math.floor(i / Math.ceil(Math.sqrt(genres.length)));
          genrePositions[gname] = [stepX * (col + 1), stepY * (row + 1)];
        });

        const simulation = d3
          .forceSimulation<ArtistNode>(nodes)
          .force(
            "link",
            d3
              .forceLink<ArtistNode, ArtistLink>(links)
              .id((d) => d.id)
              .distance(280)
              .strength(0.3)
          )
          .force("charge", d3.forceManyBody().strength(-300))
          .force(
            "collision",
            d3.forceCollide<ArtistNode>(
              (d) => radiusScale(connectionCount[d.id]) + 10
            )
          )
          // 🩵 ✅ FIXED HERE: Type-safe generic <ArtistNode> for genre access
          .force(
            "x",
            d3
              .forceX<ArtistNode>(
                (d) => genrePositions[d.genre]?.[0] || width / 2
              )
              .strength(0.2)
          )
          .force(
            "y",
            d3
              .forceY<ArtistNode>(
                (d) => genrePositions[d.genre]?.[1] || height / 2
              )
              .strength(0.2)
          )
          .on("tick", ticked)
          .on("end", freezeLayout);

        function ticked() {
          link
            .attr("x1", (d) => (d.source as ArtistNode).x || 0)
            .attr("y1", (d) => (d.source as ArtistNode).y || 0)
            .attr("x2", (d) => (d.target as ArtistNode).x || 0)
            .attr("y2", (d) => (d.target as ArtistNode).y || 0);
          node.attr("cx", (d) => d.x || 0).attr("cy", (d) => d.y || 0);
        }

        function freezeLayout() {
          simulation.stop();
          nodes.forEach((n) => {
            n.fx = n.x;
            n.fy = n.y;
          });
        }

        const legend = d3
          .select("#legend")
          .html("")
          .style("position", "absolute")
          .style("top", "20px")
          .style("right", "20px")
          .style("background", "rgba(20,20,20,0.8)")
          .style("padding", "10px 15px")
          .style("border-radius", "8px")
          .style("font-family", "Afacad, sans-serif")
          .style("font-size", "13px")
          .style("color", "#fff");

        Object.entries(genreColorMap).forEach(([genre, color]) => {
          legend
            .append("div")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", "8px")
            .style("margin-bottom", "4px")
            .html(
              `<div style="width:12px;height:12px;background:${color};border-radius:50%;"></div> ${genre}`
            );
        });

        d3.select("#resetBtn").on("click", () => {
          node.transition().attr("opacity", 1);
          link.transition().attr("opacity", 0.8);
          svg
            .transition()
            .duration(800)
            .call(
              (d3.zoom().transform as any),
              d3.zoomIdentity.translate(0, 0).scale(1)
            );
        });
      } catch (err) {
        console.error("Error fetching Bubble data:", err);
      }
    }

    fetchData();
  }, []);

  return (
    <div
      className="flex flex-col items-center min-h-screen bg-black text-white p-6 space-y-4 relative"
      style={{ fontFamily: "Afacad, sans-serif" }}
    >
      <div className="flex w-full justify-center gap-4 items-center">
        <input
          id="searchInput"
          type="text"
          placeholder="Search artist or genre..."
          className="w-1/2 p-2 rounded-md bg-gray-800 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          style={{ fontFamily: "Afacad, sans-serif" }}
        />
        <button
          id="resetBtn"
          className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-white font-medium"
          style={{ fontFamily: "Afacad, sans-serif" }}
        >
          Reset View
        </button>
      </div>
      <div id="legend"></div>
      <svg ref={svgRef}></svg>
    </div>
  );
}
