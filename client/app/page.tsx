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
        // 1️⃣ Fetch connections
        const res = await fetch(
          "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/ArtistConnection"
        );
        const json = await res.json();
        const connections = json.response.results;

        if (!connections?.length) return console.warn("No artist connections found.");

        // 2️⃣ Collect unique artists
        const uniqueArtistIds = Array.from(
          new Set([
            ...connections.map((c: any) => c.artist_11_custom_artist),
            ...connections.map((c: any) => c.artist_21_custom_artist),
          ])
        ).filter(Boolean);

        // 3️⃣ Fetch artist info
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
              name: a.name_text || "Unknown Artist",
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

        // 4️⃣ Connection counts
        const connectionCount: Record<string, number> = {};
        links.forEach((l) => {
          const s = typeof l.source === "string" ? l.source : l.source.id;
          const t = typeof l.target === "string" ? l.target : l.target.id;
          connectionCount[s] = (connectionCount[s] || 0) + 1;
          connectionCount[t] = (connectionCount[t] || 0) + 1;
        });

        // 5️⃣ Scales
        const maxConnections = Math.max(...Object.values(connectionCount));
        const radiusScale = d3.scaleSqrt().domain([1, maxConnections]).range([30, 70]); // 2x larger
        const colorScale = d3.scaleOrdinal(d3.schemeTableau10);

        const width = 1200;
        const height = 800;

        // 6️⃣ SVG Setup
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

        // 7️⃣ Image patterns
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
              .attr("preserveAspectRatio", "xMidYMid slice"); // Fill full circle
          }
        });

        // 8️⃣ Links
        const link = g
          .append("g")
          .attr("stroke", "#00aaff")
          .attr("stroke-opacity", 0.6)
          .selectAll("line")
          .data(links)
          .enter()
          .append("line")
          .attr("stroke-width", (d) => Math.sqrt(d.strength) * 2); // Double line width

        // 9️⃣ Nodes
        const node = g
          .append("g")
          .selectAll("circle")
          .data(nodes)
          .enter()
          .append("circle")
          .attr("r", (d) => radiusScale(connectionCount[d.id] || 1))
          .attr("fill", (d) => (d.image ? `url(#image-${d.id})` : "#ff6666"))
          .attr("stroke", (d) => colorScale(d.genre))
          .attr("stroke-width", 4)
          .style("cursor", "pointer");

        // 🔟 Labels (near node)
        const label = g
          .append("g")
          .selectAll("text")
          .data(nodes)
          .enter()
          .append("text")
          .text((d) => d.name)
          .attr("fill", "#fff")
          .attr("font-size", 12)
          .attr("font-family", "Afacad, sans-serif")
          .attr("text-anchor", "middle")
          .attr("dy", (d) => -(radiusScale(connectionCount[d.id] || 1) + 1)); // almost touching

        // 🧊 Simulation
        const simulation = d3
          .forceSimulation(nodes)
          .force(
            "link",
            d3
              .forceLink<ArtistNode, ArtistLink>(links)
              .id((d) => d.id)
              .distance(280)
              .strength(0.3)
          )
          .force("charge", d3.forceManyBody().strength(-250))
          .force("center", d3.forceCenter(width / 2, height / 2))
          .force(
            "collision",
            d3.forceCollide<ArtistNode>().radius(
              (d) => radiusScale(connectionCount[d.id] || 1) + 10
            )
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
          label
            .attr("x", (d) => d.x || 0)
            .attr(
              "y",
              (d) => (d.y || 0) - (radiusScale(connectionCount[d.id] || 1) + 1)
            );
        }

        function freezeLayout() {
          simulation.stop();
          nodes.forEach((n) => {
            n.fx = n.x;
            n.fy = n.y;
          });
        }

        // 🧠 Tooltip
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
          .style("opacity", 0)
          .style("transition", "opacity 0.2s ease");

        node
          .on("mouseover", (event, d) => {
            tooltip
              .html(`
                <div style="display:flex;align-items:center;gap:10px;">
                  <img src="${d.image}" width="40" height="40" style="border-radius:50%;object-fit:cover;" />
                  <div>
                    <div style="font-weight:600;">${d.name}</div>
                    <div style="color:#aaa;">${d.genre}</div>
                    <div style="color:#00aaff;font-size:12px;">Connections: ${
                      connectionCount[d.id] || 0
                    }</div>
                  </div>
                </div>
              `)
              .style("opacity", 1);
          })
          .on("mousemove", (event) => {
            tooltip
              .style("left", event.pageX + 15 + "px")
              .style("top", event.pageY - 35 + "px");
          })
          .on("mouseout", () => tooltip.style("opacity", 0));

        // 🎨 Genre Legend
        const uniqueGenres = Array.from(new Set(nodes.map((n) => n.genre)));
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

        uniqueGenres.forEach((genre) => {
          legend
            .append("div")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", "8px")
            .style("margin-bottom", "4px")
            .html(
              `<div style="width:12px;height:12px;background:${colorScale(
                genre
              )};border-radius:50%;"></div> ${genre}`
            );
        });

        // 🔁 Reset View
        d3.select("#resetBtn").on("click", () => {
          node.transition().attr("opacity", 1).attr("stroke-width", 4);
          label.transition().attr("opacity", 1);
          link.transition().attr("opacity", 0.6);
          svg
            .transition()
            .duration(800)
            .call(
              (d3.zoom().transform as any),
              d3.zoomIdentity.translate(0, 0).scale(1)
            );
        });

        // 🔍 Search
        const input = document.getElementById("searchInput") as HTMLInputElement;
        input?.addEventListener("input", () => {
          const query = input.value.toLowerCase();
          if (!query) {
            node.transition().attr("opacity", 1).attr("stroke-width", 4);
            label.transition().attr("opacity", 1);
            link.transition().attr("opacity", 0.6);
            return;
          }

          const matches = nodes.filter(
            (n) =>
              n.name.toLowerCase().includes(query) ||
              n.genre.toLowerCase().includes(query)
          );

          const matchIds = new Set(matches.map((m) => m.id));
          node
            .transition()
            .duration(400)
            .attr("opacity", (d) => (matchIds.has(d.id) ? 1 : 0.15));
          label
            .transition()
            .duration(400)
            .attr("opacity", (d) => (matchIds.has(d.id) ? 1 : 0.1));
          link
            .transition()
            .duration(400)
            .attr("opacity", (d) => {
              const s = typeof d.source === "string" ? d.source : d.source.id;
              const t = typeof d.target === "string" ? d.target : d.target.id;
              return matchIds.has(s) || matchIds.has(t) ? 0.8 : 0.1;
            });
        });
      } catch (err) {
        console.error("Error fetching Bubble data:", err);
      }
    }

    fetchData();
  }, []);

  return (
    <div className="flex flex-col items-center min-h-screen bg-black text-white p-6 space-y-4 relative">
      <div className="flex w-full justify-center gap-4 items-center">
        <input
          id="searchInput"
          type="text"
          placeholder="Search artist or genre..."
          className="w-1/2 p-2 rounded-md bg-gray-800 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          id="resetBtn"
          className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-white font-medium"
        >
          Reset View
        </button>
      </div>
      <div id="legend"></div>
      <svg ref={svgRef}></svg>
    </div>
  );
}
