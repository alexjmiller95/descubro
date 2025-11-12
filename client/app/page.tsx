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
        const res = await fetch(
          "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/ArtistConnection"
        );
        const json = await res.json();
        const connections = json.response.results;
        if (!connections?.length) return;

        const uniqueArtistIds = Array.from(
          new Set([
            ...connections.map((c: any) => c.artist_11_custom_artist),
            ...connections.map((c: any) => c.artist_21_custom_artist),
          ])
        ).filter(Boolean);

        const artistMap: Record<string, ArtistNode> = {};
        for (const id of uniqueArtistIds) {
          const res = await fetch(
            `https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/Artist/${id}`
          );
          const json = await res.json();
          const a = json.response;

          artistMap[id] = {
            id,
            name: a.name_text || "Unknown",
            image: a.image_url_text || "",
            genre: Array.isArray(a.genre_list_text)
              ? a.genre_list_text.join(", ")
              : a.genre_list_text || "Unknown",
          };
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

        // ✨ Layout constants
        const width = 1400;
        const height = 900;
        const baseRadius = 120; // doubled size
        const highlightScale = 1.1;
        const colorScale = d3.scaleOrdinal(d3.schemeTableau10);

        const genreColorMap: Record<string, string> = {};
        nodes.forEach((n) => {
          const g = n.genre.split(",")[0].trim();
          if (!genreColorMap[g]) genreColorMap[g] = colorScale(g) as string;
        });

        // SVG setup
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

        // 🖼️ Pattern fills (for circular photos)
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

        // 🔗 Links
        const link = g
          .append("g")
          .selectAll("line")
          .data(links)
          .enter()
          .append("line")
          .attr("stroke", (d) => {
            const src = typeof d.source === "string" ? d.source : d.source.id;
            const srcGenre = artistMap[src]?.genre.split(",")[0].trim();
            return genreColorMap[srcGenre] || "#00aaff";
          })
          .attr("stroke-opacity", 0.8)
          .attr("stroke-width", 4);

        // 🟣 Nodes
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

        // 🧠 Genre-separated grid layout
        const genres = Array.from(new Set(nodes.map((n) => n.genre.split(",")[0].trim())));
        const genrePositions: Record<string, [number, number]> = {};
        const stepX = width / (genres.length + 1);
        genres.forEach((gname, i) => {
          genrePositions[gname] = [stepX * (i + 1), height / 2];
        });

        // 🧩 Force simulation
        const simulation = d3
          .forceSimulation<ArtistNode>(nodes)
          .force(
            "link",
            d3
              .forceLink<ArtistNode, ArtistLink>(links)
              .id((d) => d.id)
              .distance(900) // doubled distance
          )
          .force("charge", d3.forceManyBody().strength(-1000))
          .force("collision", d3.forceCollide<ArtistNode>(baseRadius + 80)) // strong separation
          .force(
            "x",
            d3
              .forceX<ArtistNode>(
                (d) => genrePositions[d.genre.split(",")[0].trim()]?.[0] || width / 2
              )
              .strength(0.4)
          )
          .force(
            "y",
            d3
              .forceY<ArtistNode>(
                (d) => genrePositions[d.genre.split(",")[0].trim()]?.[1] || height / 2
              )
              .strength(0.4)
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

        // 🧾 Tooltip
        const tooltip = d3
          .select("body")
          .append("div")
          .style("position", "absolute")
          .style("background", "rgba(20, 20, 20, 0.95)")
          .style("color", "#fff")
          .style("padding", "10px 12px")
          .style("border-radius", "8px")
          .style("font-size", "13px")
          .style("font-family", "Afacad, sans-serif")
          .style("pointer-events", "none")
          .style("box-shadow", "0 4px 12px rgba(0,0,0,0.5)")
          .style("opacity", 0);

        function showTooltip(event: any, d: ArtistNode) {
          tooltip
            .html(
              `<strong>${d.name.toUpperCase()}</strong><br/>
               GENRE: ${d.genre.toUpperCase()}<br/>
               CONNECTIONS: ${(connectionCount[d.id] || 0).toString().toUpperCase()}`
            )
            .style("opacity", 1)
            .style("left", event.pageX + 15 + "px")
            .style("top", event.pageY - 35 + "px");
        }

        node
          .on("mouseover", showTooltip)
          .on("mousemove", showTooltip)
          .on("mouseout", () => tooltip.style("opacity", 0));

        // 🧠 Click highlight toggle
        let activeNode: ArtistNode | null = null;

        function highlightNode(selectedNode: ArtistNode, event?: any) {
          if (activeNode && activeNode.id === selectedNode.id) {
            activeNode = null;
            resetHighlight();
            tooltip.style("opacity", 0);
            return;
          }

          activeNode = selectedNode;
          showTooltip(event, selectedNode);

          const connectedIds = new Set<string>();
          links.forEach((l) => {
            const s = typeof l.source === "string" ? l.source : l.source.id;
            const t = typeof l.target === "string" ? l.target : l.target.id;
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
              const s = typeof l.source === "string" ? l.source : (l.source as ArtistNode).id;
              const t = typeof l.target === "string" ? l.target : (l.target as ArtistNode).id;
              return s === selectedNode.id || t === selectedNode.id ? 1 : 0.3;
            });
        }

        function resetHighlight() {
          node.transition().duration(200).attr("r", baseRadius).attr("opacity", 1);
          link.transition().duration(200).attr("opacity", 0.8);
        }

        node.on("click", (event, d) => highlightNode(d, event));

        // 🔍 Search
        const searchInput = d3.select("#searchInput");
        searchInput.on("input", (event: any) => {
          const value = event.target.value.toLowerCase().trim();
          if (!value) {
            resetHighlight();
            tooltip.style("opacity", 0);
            return;
          }

          const matched = nodes.filter(
            (n) =>
              n.name.toLowerCase().includes(value) ||
              n.genre.toLowerCase().includes(value)
          );
          if (matched.length > 0) highlightNode(matched[0]);
        });

        // 🔁 Reset
        d3.select("#resetBtn").on("click", () => {
          activeNode = null;
          resetHighlight();
          tooltip.style("opacity", 0);
          svg
            .transition()
            .duration(800)
            .call(
              (d3.zoom().transform as any),
              d3.zoomIdentity.translate(0, 0).scale(1)
            );
        });

        // 🎨 Legend
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
              `<div style="width:12px;height:12px;background:${color};border-radius:50%;"></div> ${genre.toUpperCase()}`
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
