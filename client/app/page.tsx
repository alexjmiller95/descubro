"use client";
import { useEffect, useRef } from "react";
import * as d3 from "d3";

// 🧩 Define proper types for D3 simulation
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
        // 1️⃣ Fetch artist connections
        const res = await fetch(
          "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/ArtistConnection"
        );
        const json = await res.json();
        const connections = json.response.results;

        if (!connections || connections.length === 0) {
          console.warn("No artist connections found.");
          return;
        }

        // 2️⃣ Collect unique artist IDs
        const uniqueArtistIds = Array.from(
          new Set([
            ...connections.map((c: any) => c.artist_11_custom_artist),
            ...connections.map((c: any) => c.artist_21_custom_artist),
          ])
        ).filter(Boolean);

        console.log("Unique artist IDs:", uniqueArtistIds);

        // 3️⃣ Fetch artist details
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
                ? a.genre_list_text.join(", ")
                : a.genre_list_text || "Unknown Genre",
            };
          } catch (err) {
            console.error(`Error fetching artist ${artistId}:`, err);
          }
        }

        console.log("🎨 Artist map:", artistMap);

        // 4️⃣ Build nodes & links
        const nodes: ArtistNode[] = Object.values(artistMap);
        const links: ArtistLink[] = connections
          .map((c: any) => ({
            source: c.artist_11_custom_artist,
            target: c.artist_21_custom_artist,
            strength: c.connection_strength_number || 1,
          }))
          .filter(
            (l: ArtistLink) => artistMap[l.source as string] && artistMap[l.target as string]
          );

        if (nodes.length === 0 || links.length === 0) {
          console.warn("⚠️ No valid nodes or links to visualize.");
          return;
        }

        // 5️⃣ Compute connection counts for dynamic sizing (typed)
        const connectionCount: Record<string, number> = {};
        links.forEach((l: ArtistLink) => {
          const sourceId = typeof l.source === "string" ? l.source : l.source.id;
          const targetId = typeof l.target === "string" ? l.target : l.target.id;
          connectionCount[sourceId] = (connectionCount[sourceId] || 0) + 1;
          connectionCount[targetId] = (connectionCount[targetId] || 0) + 1;
        });

        const maxConnections = Math.max(...Object.values(connectionCount));
        const radiusScale = d3
          .scaleSqrt()
          .domain([1, maxConnections])
          .range([15, 35]); // 🟢 Halved base size from previous 30–70

        // 6️⃣ Set up SVG
        const width = 1000;
        const height = 700;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
        svg
          .attr("width", width)
          .attr("height", height)
          .style("background", "#0b0b0b");

        // 7️⃣ Define image patterns
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
              .attr("width", 80)
              .attr("height", 80)
              .attr("x", 0)
              .attr("y", 0);
          }
        });

        // 8️⃣ Links
        const link = svg
          .append("g")
          .attr("stroke", "#00aaff")
          .attr("stroke-opacity", 0.6)
          .selectAll("line")
          .data(links)
          .enter()
          .append("line")
          .attr("stroke-width", (d) => Math.sqrt(d.strength));

        // 9️⃣ Nodes (with dynamic size and image)
        const node = svg
          .append("g")
          .selectAll("circle")
          .data(nodes)
          .enter()
          .append("circle")
          .attr("r", (d) => radiusScale(connectionCount[d.id] || 1))
          .attr("fill", (d) => (d.image ? `url(#image-${d.id})` : "#ff6666"))
          .attr("stroke", "#fff")
          .attr("stroke-width", 1.5)
          .call(
            d3
              .drag<SVGCircleElement, ArtistNode>()
              .on("start", dragstarted)
              .on("drag", dragged)
              .on("end", dragended)
          );

        // 🔟 Tooltip (artist + genre)
        const tooltip = d3
          .select("body")
          .append("div")
          .style("position", "absolute")
          .style("background", "rgba(0,0,0,0.85)")
          .style("color", "#fff")
          .style("padding", "6px 10px")
          .style("border-radius", "6px")
          .style("font-size", "12px")
          .style("pointer-events", "none")
          .style("opacity", 0);

        node
          .on("mouseover", (event, d) => {
            tooltip
              .html(`<strong>${d.name}</strong><br/><em>${d.genre}</em>`)
              .style("opacity", 1);
          })
          .on("mousemove", (event) => {
            tooltip
              .style("left", event.pageX + 12 + "px")
              .style("top", event.pageY - 28 + "px");
          })
          .on("mouseout", () => tooltip.style("opacity", 0));

        // 1️⃣1️⃣ Labels (positioned above node)
        const label = svg
          .append("g")
          .selectAll("text")
          .data(nodes)
          .enter()
          .append("text")
          .text((d) => d.name)
          .attr("fill", "#fff")
          .attr("font-size", 11)
          .attr("font-family", "Afacad, sans-serif")
          .attr("text-anchor", "middle")
          .attr("dy", -radiusScale(2) - 6);

        // 1️⃣2️⃣ Force simulation with collision detection 🧠
        const simulation = d3
          .forceSimulation<ArtistNode>(nodes)
          .force(
            "link",
            d3
              .forceLink<ArtistNode, ArtistLink>(links)
              .id((d) => d.id)
              .distance(140)
              .strength(0.3)
          )
          .force("charge", d3.forceManyBody().strength(-250))
          .force("center", d3.forceCenter(width / 2, height / 2))
          .force(
            "collision",
            d3.forceCollide<ArtistNode>().radius((d) => radiusScale(connectionCount[d.id] || 1) + 6)
          ) // Prevent overlap
          .on("tick", ticked);

        function ticked() {
          link
            .attr("x1", (d) => (d.source as ArtistNode).x || 0)
            .attr("y1", (d) => (d.source as ArtistNode).y || 0)
            .attr("x2", (d) => (d.target as ArtistNode).x || 0)
            .attr("y2", (d) => (d.target as ArtistNode).y || 0);

          node.attr("cx", (d) => d.x || 0).attr("cy", (d) => d.y || 0);
          label.attr("x", (d) => d.x || 0).attr("y", (d) => (d.y || 0) - (radiusScale(connectionCount[d.id] || 1) + 8));
        }

        function dragstarted(event: any, d: ArtistNode) {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        }

        function dragged(event: any, d: ArtistNode) {
          d.fx = event.x;
          d.fy = event.y;
        }

        function dragended(event: any, d: ArtistNode) {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }
      } catch (err) {
        console.error("Error fetching Bubble data:", err);
      }
    }

    fetchData();
  }, []);

  return (
    <div className="flex justify-center items-center min-h-screen bg-black">
      <svg ref={svgRef}></svg>
    </div>
  );
}
