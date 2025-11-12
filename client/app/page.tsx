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
        // 1️⃣ Fetch artist connections
        const res = await fetch(
          "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/ArtistConnection"
        );
        const json = await res.json();
        const connections = json.response.results;

        if (!connections?.length) return console.warn("No artist connections found.");

        // 2️⃣ Get unique artist IDs
        const uniqueArtistIds = Array.from(
          new Set([
            ...connections.map((c: any) => c.artist_11_custom_artist),
            ...connections.map((c: any) => c.artist_21_custom_artist),
          ])
        ).filter(Boolean);

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

        // 4️⃣ Build graph
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

        // 5️⃣ Connection counts
        const connectionCount: Record<string, number> = {};
        links.forEach((l) => {
          const s = typeof l.source === "string" ? l.source : l.source.id;
          const t = typeof l.target === "string" ? l.target : l.target.id;
          connectionCount[s] = (connectionCount[s] || 0) + 1;
          connectionCount[t] = (connectionCount[t] || 0) + 1;
        });

        const maxConnections = Math.max(...Object.values(connectionCount));
        const radiusScale = d3.scaleSqrt().domain([1, maxConnections]).range([15, 35]);

        // 6️⃣ Setup SVG + groups
        const width = 1200;
        const height = 800;
        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
        svg
          .attr("width", width)
          .attr("height", height)
          .style("background", "#0b0b0b");

        const g = svg.append("g");

        // 7️⃣ Zoom & Pan
        (svg as any).call(
          d3
            .zoom()
            .scaleExtent([0.3, 4])
            .on("zoom", (event: any) => {
              g.attr("transform", event.transform);
            })
        );

        // 8️⃣ Define image patterns
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
              .attr("height", 80);
          }
        });

        // 9️⃣ Draw links
        const link = g
          .append("g")
          .attr("stroke", "#00aaff")
          .attr("stroke-opacity", 0.6)
          .selectAll("line")
          .data(links)
          .enter()
          .append("line")
          .attr("stroke-width", (d) => Math.sqrt(d.strength));

        // 🔟 Draw nodes
        const node = g
          .append("g")
          .selectAll("circle")
          .data(nodes)
          .enter()
          .append("circle")
          .attr("r", (d) => radiusScale(connectionCount[d.id] || 1))
          .attr("fill", (d) => (d.image ? `url(#image-${d.id})` : "#ff6666"))
          .attr("stroke", "#fff")
          .attr("stroke-width", 1.5)
          .style("cursor", "pointer");

        // 🏷️ Draw labels
        const label = g
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
          .attr("dy", (d) => -(radiusScale(connectionCount[d.id] || 1) + 8));

        // 🧠 Simulation (for layout only once)
        const simulation = d3
          .forceSimulation(nodes)
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
            d3.forceCollide<ArtistNode>().radius(
              (d) => radiusScale(connectionCount[d.id] || 1) + 6
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
              (d) => (d.y || 0) - (radiusScale(connectionCount[d.id] || 1) + 8)
            );
        }

        function freezeLayout() {
          simulation.stop();
          nodes.forEach((n) => {
            n.fx = n.x;
            n.fy = n.y;
          });
        }

        // 🎯 Helper: focus and highlight logic
        function focusOn(targetNodes: ArtistNode[]) {
          const targetIds = new Set(targetNodes.map((n) => n.id));

          const connectedIds = new Set<string>();
          links.forEach((l) => {
            const s = typeof l.source === "string" ? l.source : l.source.id;
            const t = typeof l.target === "string" ? l.target : l.target.id;
            if (targetIds.has(s)) connectedIds.add(t);
            if (targetIds.has(t)) connectedIds.add(s);
          });

          node
            .transition()
            .duration(400)
            .attr("opacity", (d) =>
              targetIds.has(d.id) || connectedIds.has(d.id) ? 1 : 0.15
            )
            .attr("stroke-width", (d) => (targetIds.has(d.id) ? 4 : 1.5));

          label
            .transition()
            .duration(400)
            .attr("opacity", (d) =>
              targetIds.has(d.id) || connectedIds.has(d.id) ? 1 : 0.1
            );

          link
            .transition()
            .duration(400)
            .attr("opacity", (d) => {
              const s = typeof d.source === "string" ? d.source : d.source.id;
              const t = typeof d.target === "string" ? d.target : d.target.id;
              return targetIds.has(s) || targetIds.has(t) ? 0.8 : 0.1;
            });

          // Center camera
          if (targetNodes.length > 0) {
            const avgX =
              targetNodes.reduce((acc, n) => acc + (n.x || 0), 0) /
              targetNodes.length;
            const avgY =
              targetNodes.reduce((acc, n) => acc + (n.y || 0), 0) /
              targetNodes.length;

            svg
              .transition()
              .duration(800)
              .call(
                (d3.zoom().transform as any),
                d3.zoomIdentity
                  .translate(width / 2 - avgX * 1.5, height / 2 - avgY * 1.5)
                  .scale(1.5)
              );
          }
        }

        // 🖱️ Click to focus on artist
        node.on("click", (_, d) => {
          focusOn([d]);
          const search = document.getElementById(
            "searchInput"
          ) as HTMLInputElement;
          if (search) search.value = d.name;
        });

        // 🔍 Search: Artist or Genre
        const input = document.getElementById("searchInput") as HTMLInputElement;
        input?.addEventListener("input", () => {
          const query = input.value.toLowerCase();

          if (!query) {
            node.transition().attr("opacity", 1).attr("stroke-width", 1.5);
            label.transition().attr("opacity", 1);
            link.transition().attr("opacity", 0.6);
            return;
          }

          // Artist search
          const artistMatches = nodes.filter((n) =>
            n.name.toLowerCase().includes(query)
          );
          // Genre search
          const genreMatches = nodes.filter((n) =>
            n.genre.toLowerCase().includes(query)
          );

          const matches = artistMatches.length ? artistMatches : genreMatches;
          focusOn(matches);
        });
      } catch (err) {
        console.error("Error fetching Bubble data:", err);
      }
    }

    fetchData();
  }, []);

  return (
    <div className="flex flex-col items-center min-h-screen bg-black text-white p-6 space-y-4">
      <input
        id="searchInput"
        type="text"
        placeholder="Search artist or genre..."
        className="w-1/2 p-2 rounded-md bg-gray-800 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <svg ref={svgRef}></svg>
    </div>
  );
}
