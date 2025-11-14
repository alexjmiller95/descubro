"use client";
import { useEffect, useRef } from "react";
import * as d3 from "d3";

interface ArtistNode extends d3.SimulationNodeDatum {
  id: string;            // Spotify ID
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
        console.log("Fetching ArtistConnections…");

        // 1️⃣ Fetch all ArtistConnection objects
        const resConnections = await fetch(
          "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/ArtistConnection?limit=2000"
        );
        const jsonConnections = await resConnections.json();
        const connections = jsonConnections.response.results;

        if (!connections || connections.length === 0) {
          console.warn("No artist connections found.");
          return;
        }

        console.log(`Received ${connections.length} connections`);

        // Extract all Bubble Artist IDs
        const bubbleArtistIds = Array.from(
          new Set([
            ...connections.map((c: any) => c.artist_11_custom_artist),
            ...connections.map((c: any) => c.artist_21_custom_artist),
          ])
        ).filter(Boolean);

        console.log(`Unique Bubble artist IDs: ${bubbleArtistIds.length}`);

        // 2️⃣ Fetch all artists and map Bubble ID → Spotify ID
        const bubbleIdToSpotify: Record<string, string> = {};
        const spotifyIdSet = new Set<string>();
        const artistMapBySpotify: Record<string, ArtistNode> = {};

        for (const bubbleId of bubbleArtistIds) {
          const res = await fetch(
            `https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/Artist/${bubbleId}`
          );
          const json = await res.json();
          const a = json.response;

          const spotifyId = a.spotify_id_text;
          if (!spotifyId) continue;

          bubbleIdToSpotify[bubbleId] = spotifyId;

          if (!spotifyIdSet.has(spotifyId)) {
            spotifyIdSet.add(spotifyId);

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

        console.log(`Unique Spotify artists: ${spotifyIdSet.size}`);

        // 3️⃣ Build deduplicated node list
        const nodes: ArtistNode[] = Object.values(artistMapBySpotify);

        // 4️⃣ Build links using Spotify IDs (deduped)
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
            (l: ArtistLink) =>
              typeof l.source === "string" &&
              typeof l.target === "string" &&
              artistMapBySpotify[l.source] &&
              artistMapBySpotify[l.target]
          );

        console.log(`Valid links: ${links.length}`);

        // Count number of connections per node
        const connectionCount: Record<string, number> = {};
        links.forEach((l) => {
          const s = l.source as string;
          const t = l.target as string;

          connectionCount[s] = (connectionCount[s] || 0) + 1;
          connectionCount[t] = (connectionCount[t] || 0) + 1;
        });

        // -------------------------------
        // D3 GRAPH RENDERING STARTS HERE
        // -------------------------------

        const width = 1400;
        const height = 900;
        const baseRadius = 120;
        const highlightScale = 1.12;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
        svg.attr("width", width).attr("height", height).style("background", "#000");

        const g = svg.append("g");

        (svg as any).call(
          d3
            .zoom()
            .scaleExtent([0.3, 3])
            .on("zoom", (event: any) => g.attr("transform", event.transform))
        );

        // Color scale by genre
        const colorScale = d3.scaleOrdinal(d3.schemeTableau10);
        const genreColorMap: Record<string, string> = {};
        nodes.forEach((n) => {
          const g = n.genre.split(",")[0].trim();
          if (!genreColorMap[g]) genreColorMap[g] = colorScale(g) as string;
        });

        // Patterns for circular artist images
        const defs = svg.append("defs");
        nodes.forEach((n) => {
          const pattern = defs
            .append("pattern")
            .attr("id", `img-${n.id}`)
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
          .attr("stroke", (d: ArtistLink) => {
            const s = d.source as string;
            const srcGenre = artistMapBySpotify[s].genre.split(",")[0].trim();
            return genreColorMap[srcGenre];
          })
          .attr("stroke-opacity", 0.8)
          .attr("stroke-width", 4);

        // Draw nodes
        const node = g
          .append("g")
          .selectAll("circle")
          .data(nodes)
          .enter()
          .append("circle")
          .attr("r", baseRadius)
          .attr("fill", (d) => `url(#img-${d.id})`)
          .attr("stroke", (d) => genreColorMap[d.genre.split(",")[0].trim()])
          .attr("stroke-width", 5)
          .style("cursor", "pointer");

        // Force layout
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

        // Tooltip
        const tooltip = d3
          .select("body")
          .append("div")
          .style("position", "absolute")
          .style("background", "#111")
          .style("color", "#fff")
          .style("padding", "10px 14px")
          .style("border-radius", "8px")
          .style("pointer-events", "none")
          .style("opacity", 0);

        function showTooltip(event: any, d: ArtistNode) {
          tooltip
            .html(
              `<b>${d.name}</b><br>
               Genre: ${d.genre}<br>
               Connections: ${connectionCount[d.id] || 0}`
            )
            .style("opacity", 1)
            .style("left", event.pageX + 10 + "px")
            .style("top", event.pageY - 28 + "px");
        }

        let activeNode: ArtistNode | null = null;

        function highlightNode(selected: ArtistNode, event: any) {
          if (activeNode?.id === selected.id) {
            resetHighlight();
            activeNode = null;
            return;
          }

          activeNode = selected;
          showTooltip(event, selected);

          const connected = new Set<string>();
          links.forEach((l) => {
            const s = l.source as string;
            const t = l.target as string;
            if (s === selected.id || t === selected.id) {
              connected.add(s);
              connected.add(t);
            }
          });

          node
            .transition()
            .duration(250)
            .attr("opacity", (n) =>
              n.id === selected.id || connected.has(n.id) ? 1 : 0.4
            )
            .attr("r", (n) =>
              n.id === selected.id || connected.has(n.id)
                ? baseRadius * highlightScale
                : baseRadius
            );

          link
            .transition()
            .duration(250)
            .attr("opacity", (l) => {
              const s = l.source as string;
              const t = l.target as string;
              return s === selected.id || t === selected.id ? 1 : 0.3;
            });
        }

        function resetHighlight() {
          tooltip.style("opacity", 0);
          node.transition().duration(250).attr("opacity", 1).attr("r", baseRadius);
          link.transition().duration(250).attr("opacity", 0.8);
        }

        node
          .on("mouseover", showTooltip)
          .on("mousemove", showTooltip)
          .on("mouseout", () => tooltip.style("opacity", 0))
          .on("click", (event, d) => highlightNode(d, event));

      } catch (err) {
        console.error("ERROR:", err);
      }
    }

    fetchData();
  }, []);

  return (
    <div className="flex flex-col items-center min-h-screen bg-black text-white p-6 space-y-4">
      <svg ref={svgRef}></svg>
    </div>
  );
}
