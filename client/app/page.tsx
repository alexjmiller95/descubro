"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";

interface ArtistNode extends d3.SimulationNodeDatum {
  id: string; // spotify id (or fallback)
  name: string;
  image: string;
  genre: string; // comma-separated string
}

interface ArtistLink extends d3.SimulationLinkDatum<ArtistNode> {
  source: string | ArtistNode;
  target: string | ArtistNode;
  strength: number;
  genre: string;
}

export default function Home() {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        console.log("Fetching Artists…");

        const resArtists = await fetch(
          "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/Artist?limit=500"
        );
        const jsonArtists = await resArtists.json();
        const artistsRaw: any[] = jsonArtists.response?.results || [];

        console.log("Received Artists:", artistsRaw.length);

        if (!artistsRaw.length) {
          console.warn("No artists returned – check Bubble Data API / privacy.");
          return;
        }

        // --------------------------------------------------------
        // 1. Build unique artist nodes (dedupe by Spotify ID)
        // --------------------------------------------------------
        const artistMap: Record<string, ArtistNode> = {};

        artistsRaw.forEach((a) => {
          // ⬅️ MAP BUBBLE FIELDS HERE
          const spotifyId: string =
            a.spotify_id ||
            a.spotify_id_text ||
            a.id_text ||
            a.artist_id ||
            a.id;

          if (!spotifyId) return;

          const name: string = a.name || a.name_text || "Unknown";

          const image: string =
            a.image_url || a.image_url_text || "" /* optional fallback */;

          const genreList: string[] =
            a.genre ||
            a.genre_list_text ||
            []; // expect array of text genres

          const genreString =
            Array.isArray(genreList) && genreList.length
              ? genreList.join(", ")
              : "Unknown";

          if (!artistMap[spotifyId]) {
            artistMap[spotifyId] = {
              id: spotifyId,
              name,
              image,
              genre: genreString,
            };
          }
        });

        const nodes: ArtistNode[] = Object.values(artistMap);
        console.log("Unique Spotify artists (nodes):", nodes.length);

        if (!nodes.length) {
          console.warn("No artist nodes built – nothing to render.");
          return;
        }

        // --------------------------------------------------------
        // 2. Build links by shared primary genre
        //    (primary genre = first in list, before first comma)
        // --------------------------------------------------------
        const genreGroups: Record<string, ArtistNode[]> = {};
        nodes.forEach((n) => {
          const primary = n.genre.split(",")[0].trim() || "Unknown";
          if (!genreGroups[primary]) genreGroups[primary] = [];
          genreGroups[primary].push(n);
        });

        const links: ArtistLink[] = [];

        Object.entries(genreGroups).forEach(([g, groupNodes]) => {
          if (groupNodes.length < 2) return;
          // Simple chain: connect each consecutive pair in the genre group
          const sorted = [...groupNodes].sort((a, b) =>
            a.name.localeCompare(b.name)
          );
          for (let i = 0; i < sorted.length - 1; i++) {
            links.push({
              source: sorted[i].id,
              target: sorted[i + 1].id,
              strength: 1,
              genre: g,
            });
          }
        });

        console.log("Genre-based links:", links.length);

        // --------------------------------------------------------
        // 3. Compute connection counts for tooltip
        // --------------------------------------------------------
        const connectionCount: Record<string, number> = {};
        links.forEach((l) => {
          const s = typeof l.source === "string" ? l.source : l.source.id;
          const t = typeof l.target === "string" ? l.target : l.target.id;
          connectionCount[s] = (connectionCount[s] || 0) + 1;
          connectionCount[t] = (connectionCount[t] || 0) + 1;
        });

        // --------------------------------------------------------
        // 4. Visual constants & colour scales
        // --------------------------------------------------------
        const width = 1400;
        const height = 900;
        const baseRadius = 240; // 100% larger than 120
        const highlightScale = 1.1;

        const colorScale = d3.scaleOrdinal(d3.schemeTableau10);
        const genreColorMap: Record<string, string> = {};
        Object.keys(genreGroups).forEach((gName) => {
          genreColorMap[gName] = colorScale(gName) as string;
        });

        // --------------------------------------------------------
        // 5. SVG + base groups
        // --------------------------------------------------------
        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();

        svg
          .attr("width", width)
          .attr("height", height)
          .style("background", "#000000");

        const g = svg.append("g");

        (svg as any).call(
          d3
            .zoom()
            .scaleExtent([0.3, 3])
            .on("zoom", (event: any) => g.attr("transform", event.transform))
        );

        // --------------------------------------------------------
        // 6. Image patterns
        // --------------------------------------------------------
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

        // --------------------------------------------------------
        // 7. Links
        // --------------------------------------------------------
        const link = g
          .append("g")
          .attr("stroke-linecap", "round")
          .selectAll("line")
          .data(links)
          .enter()
          .append("line")
          .attr("stroke", (d: ArtistLink) => {
            const gName = d.genre || "Unknown";
            return genreColorMap[gName] || "#888888";
          })
          .attr("stroke-opacity", 0.7)
          .attr("stroke-width", 4);

        // --------------------------------------------------------
        // 8. Nodes
        // --------------------------------------------------------
        const node = g
          .append("g")
          .selectAll("circle")
          .data(nodes)
          .enter()
          .append("circle")
          .attr("r", baseRadius)
          .attr("fill", (d) => `url(#image-${d.id})`)
          .attr("stroke", (d) => {
            const primary = d.genre.split(",")[0].trim() || "Unknown";
            return genreColorMap[primary] || "#ffffff";
          })
          .attr("stroke-width", 6)
          .style("cursor", "pointer");

        // --------------------------------------------------------
        // 9. Force simulation (genre-based bands horizontally)
        // --------------------------------------------------------
        const genreNames = Object.keys(genreGroups);
        const stepX = width / (genreNames.length + 1);
        const genrePositions: Record<string, [number, number]> = {};
        genreNames.forEach((gName, i) => {
          genrePositions[gName] = [stepX * (i + 1), height / 2];
        });

        const simulation = d3
          .forceSimulation<ArtistNode>(nodes)
          .force(
            "link",
            d3
              .forceLink<ArtistNode, ArtistLink>(links)
              .id((d) => d.id)
              .distance(900)
          )
          .force("charge", d3.forceManyBody().strength(-2000))
          .force("collision", d3.forceCollide<ArtistNode>(baseRadius + 60))
          .force(
            "x",
            d3
              .forceX<ArtistNode>((d) => {
                const primary = d.genre.split(",")[0].trim() || "Unknown";
                return genrePositions[primary]?.[0] ?? width / 2;
              })
              .strength(0.4)
          )
          .force(
            "y",
            d3
              .forceY<ArtistNode>(() => height / 2)
              .strength(0.1)
          )
          .on("tick", ticked);

        function ticked() {
          link
            .attr("x1", (d: any) => (d.source as ArtistNode).x ?? 0)
            .attr("y1", (d: any) => (d.source as ArtistNode).y ?? 0)
            .attr("x2", (d: any) => (d.target as ArtistNode).x ?? 0)
            .attr("y2", (d: any) => (d.target as ArtistNode).y ?? 0);

          node
            .attr("cx", (d: any) => d.x ?? 0)
            .attr("cy", (d: any) => d.y ?? 0);
        }

        // --------------------------------------------------------
        // 10. Tooltip
        // --------------------------------------------------------
        const tooltip = d3
          .select("body")
          .append("div")
          .style("position", "absolute")
          .style("background", "rgba(20,20,20,0.95)")
          .style("color", "#ffffff")
          .style("padding", "10px 14px")
          .style("border-radius", "8px")
          .style("font-family", "Afacad, sans-serif")
          .style("font-size", "13px")
          .style("pointer-events", "none")
          .style("box-shadow", "0 4px 12px rgba(0,0,0,0.6)")
          .style("opacity", 0);

        function showTooltip(event: any, d: ArtistNode) {
          tooltip
            .html(
              `<strong>${d.name.toUpperCase()}</strong><br/>
               GENRES: ${d.genre.toUpperCase()}<br/>
               CONNECTIONS: ${(connectionCount[d.id] || 0)
                 .toString()
                 .toUpperCase()}`
            )
            .style("opacity", 1)
            .style("left", `${event.pageX + 15}px`)
            .style("top", `${event.pageY - 35}px`);
        }

        node
          .on("mouseover", showTooltip)
          .on("mousemove", showTooltip)
          .on("mouseout", () => tooltip.style("opacity", 0));

        // --------------------------------------------------------
        // 11. Highlight logic on click
        // --------------------------------------------------------
        let activeNode: ArtistNode | null = null;

        function resetHighlight() {
          node
            .transition()
            .duration(200)
            .attr("r", baseRadius)
            .attr("opacity", 1);

          link.transition().duration(200).attr("opacity", 0.7);
        }

        function highlightNode(selectedNode: ArtistNode, event?: any) {
          // Toggle
          if (activeNode && activeNode.id === selectedNode.id) {
            activeNode = null;
            resetHighlight();
            tooltip.style("opacity", 0);
            return;
          }

          activeNode = selectedNode;
          if (event) showTooltip(event, selectedNode);

          const connectedIds = new Set<string>();
          links.forEach((l) => {
            const s =
              typeof l.source === "string"
                ? l.source
                : (l.source as ArtistNode).id;
            const t =
              typeof l.target === "string"
                ? l.target
                : (l.target as ArtistNode).id;
            if (s === selectedNode.id || t === selectedNode.id) {
              connectedIds.add(s);
              connectedIds.add(t);
            }
          });

          node
            .transition()
            .duration(200)
            .attr("r", (d) =>
              d.id === selectedNode.id || connectedIds.has(d.id)
                ? baseRadius * highlightScale
                : baseRadius
            )
            .attr("opacity", (d) =>
              d.id === selectedNode.id || connectedIds.has(d.id) ? 1 : 0.5
            );

          link
            .transition()
            .duration(200)
            .attr("opacity", (l) => {
              const s =
                typeof l.source === "string"
                  ? l.source
                  : (l.source as ArtistNode).id;
              const t =
                typeof l.target === "string"
                  ? l.target
                  : (l.target as ArtistNode).id;
              return s === selectedNode.id || t === selectedNode.id ? 1 : 0.2;
            });
        }

        node.on("click", (event, d) => highlightNode(d, event));

        // --------------------------------------------------------
        // 12. Search + reset buttons (DOM elements already in JSX)
        // --------------------------------------------------------
        const searchInput = d3.select<HTMLInputElement, unknown>("#searchInput");
        const resetBtn = d3.select<HTMLButtonElement, unknown>("#resetBtn");

        searchInput.on("input", (event: any) => {
          const value: string = event.target.value.toLowerCase().trim();
          if (!value) {
            activeNode = null;
            resetHighlight();
            tooltip.style("opacity", 0);
            return;
          }

          const matched = nodes.find(
            (n) =>
              n.name.toLowerCase().includes(value) ||
              n.genre.toLowerCase().includes(value)
          );
          if (matched) highlightNode(matched);
        });

        resetBtn.on("click", () => {
          activeNode = null;
          resetHighlight();
          tooltip.style("opacity", 0);
          searchInput.property("value", "");
          svg
            .transition()
            .duration(600)
            .call(
              (d3.zoom().transform as any),
              d3.zoomIdentity.translate(0, 0).scale(1)
            );
        });

        // --------------------------------------------------------
        // 13. Genre legend (top-right)
        // --------------------------------------------------------
        const legend = d3
          .select("#legend")
          .html("")
          .style("position", "absolute")
          .style("top", "20px")
          .style("right", "20px")
          .style("background", "rgba(20,20,20,0.85)")
          .style("padding", "10px 16px")
          .style("border-radius", "10px")
          .style("font-family", "Afacad, sans-serif")
          .style("font-size", "13px")
          .style("color", "#ffffff");

        Object.entries(genreColorMap).forEach(([genre, color]) => {
          legend
            .append("div")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", "8px")
            .style("margin-bottom", "4px")
            .html(
              `<div style="width:12px;height:12px;border-radius:50%;background:${color};"></div> ${genre.toUpperCase()}`
            );
        });
      } catch (err) {
        console.error("Error building graph:", err);
      }
    }

    fetchData();
  }, []);

  return (
    <div
      className="flex flex-col items-center min-h-screen bg-black text-white p-6 space-y-4 relative"
      style={{ fontFamily: "Afacad, sans-serif" }}
    >
      <div className="flex w-full justify-center gap-4 items-center mb-2">
        <input
          id="searchInput"
          type="text"
          placeholder="Search artist or genre..."
          className="w-1/2 p-2 rounded-md bg-gray-800 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          id="resetBtn"
          className="px-4 py-2 rounded text-white font-medium"
          style={{ backgroundColor: "#121212" }}
        >
          Reset View
        </button>
      </div>

      <div id="legend"></div>
      <svg ref={svgRef}></svg>
    </div>
  );
}
