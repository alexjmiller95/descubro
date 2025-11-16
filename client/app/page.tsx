"use client";

import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { SimulationNodeDatum } from "d3";

/* ============================================================
   TYPES
   ============================================================ */

export interface ArtistRecord extends SimulationNodeDatum {
  id: string;
  name: string;
  genre: string[];
  image: string | null;
  spotify: string | null;
}

export interface Link
  extends d3.SimulationLinkDatum<ArtistRecord> {
  source: string | ArtistRecord;
  target: string | ArtistRecord;
  sourceId: string;
  targetId: string;
  genre: string;
}

/* ============================================================
   CONSTANTS
   ============================================================ */

const NODE_RADIUS = 20; // 50% smaller
const LINE_WIDTH = 2;   // 2x thicker than default
const GENRE_FALLBACK_COLOR = "#888888";

const ARTIST_API =
  "https://alexjmiller95.bubbleapps.io/version-test/api/1.1/obj/Artist?limit=500";

/* ============================================================
   COMPONENT
   ============================================================ */

export default function Page() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const minimapRef = useRef<SVGSVGElement | null>(null);

  /* ------------------------------------------------------------
      MAIN EFFECT – fetch + draw
     ------------------------------------------------------------ */
  useEffect(() => {
    async function run() {
      if (!svgRef.current || !minimapRef.current) return;

      // ---------- 1. Fetch artists from Bubble ----------
      let artistsRaw: any[] = [];
      try {
        const res = await fetch(ARTIST_API);
        if (!res.ok) {
          console.error("Artist API error:", res.status, res.statusText);
          return;
        }
        const json = await res.json();
        artistsRaw = json.response?.results ?? [];
      } catch (err) {
        console.error("Failed to fetch artists:", err);
        return;
      }

      if (!artistsRaw.length) {
        console.warn("No artists returned from Bubble.");
        return;
      }

      // Map Bubble fields → ArtistRecord
      const nodes: ArtistRecord[] = artistsRaw.map((a: any) => {
        const id =
          a.spotify_id_text ||
          a.spotify_id ||
          a.artist_id ||
          a._id ||
          String(Math.random());

        const name =
          a.name_text || a.name || a.artist_name || "Unknown";

        const genreList: string[] =
          Array.isArray(a.genre_list_text) && a.genre_list_text.length
            ? a.genre_list_text
            : Array.isArray(a.genre)
            ? a.genre
            : typeof a.genre === "string"
            ? [a.genre]
            : [];

        const image: string | null =
          a.image_url_text || a.image_url || null;

        const spotify: string | null =
          a.spotify_id_text || a.spotify_id || null;

        return {
          id,
          name,
          genre: genreList,
          image,
          spotify,
        };
      });

      // ---------- 2. Build links by shared primary genre ----------
      const primaryGenres = nodes.map((n) =>
        (n.genre[0] ?? "unknown").toLowerCase()
      );
      const uniqueGenres = Array.from(new Set(primaryGenres));

      const colorScale = d3
        .scaleOrdinal<string, string>(d3.schemeTableau10)
        .domain(uniqueGenres);

      const genreColor: Record<string, string> = {};
      uniqueGenres.forEach((g) => (genreColor[g] = colorScale(g)));

      const bandStep =
        (typeof window !== "undefined"
          ? window.innerWidth
          : 1400) /
        (uniqueGenres.length + 1);
      const genreCenterX: Record<string, number> = {};
      uniqueGenres.forEach((g, i) => {
        genreCenterX[g] = bandStep * (i + 1);
      });

      const links: Link[] = [];
      const groups: Record<string, ArtistRecord[]> = {};
      nodes.forEach((n) => {
        const g = (n.genre[0] ?? "unknown").toLowerCase();
        if (!groups[g]) groups[g] = [];
        groups[g].push(n);
      });

      Object.entries(groups).forEach(([g, groupNodes]) => {
        if (groupNodes.length < 2) return;
        const sorted = [...groupNodes].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        for (let i = 0; i < sorted.length - 1; i++) {
          const s = sorted[i];
          const t = sorted[i + 1];
          links.push({
            source: s.id,
            target: t.id,
            sourceId: s.id,
            targetId: t.id,
            genre: g,
          });
        }
      });

      // ---------- 3. Setup SVGs ----------
      const svg = d3.select(svgRef.current);
      const minimapSvg = d3.select(minimapRef.current);
      svg.selectAll("*").remove();
      minimapSvg.selectAll("*").remove();

      const width =
        typeof window !== "undefined" ? window.innerWidth : 1400;
      const height =
        typeof window !== "undefined" ? window.innerHeight : 900;

      const minimapWidth = 220;
      const minimapHeight = 220;
      const scaleX = minimapWidth / width;
      const scaleY = minimapHeight / height;

      svg
        .attr("width", width)
        .attr("height", height)
        .style("background", "black");

      minimapSvg
        .attr("width", minimapWidth)
        .attr("height", minimapHeight)
        .style("background", "rgba(10,10,10,0.9)");

      const mainG = svg.append("g");
      const minimapG = minimapSvg.append("g");

      // ---------- 4. Tooltip ----------
      const tooltip = d3
        .select("body")
        .append("div")
        .style("position", "absolute")
        .style("padding", "8px 12px")
        .style("background", "rgba(0,0,0,0.85)")
        .style("color", "#ffffff")
        .style("border-radius", "6px")
        .style("font-size", "12px")
        .style("font-family", "Afacad, sans-serif")
        .style("pointer-events", "none")
        .style("opacity", 0);

      // ---------- 5. Image patterns (perfect circular portraits) ----------
      const defs = mainG.append("defs");
      nodes.forEach((n) => {
        if (!n.image) return;
        const pattern = defs
          .append("pattern")
          .attr("id", `img-${n.id}`)
          .attr("patternUnits", "objectBoundingBox")
          .attr("width", 1)
          .attr("height", 1);

        pattern
          .append("image")
          .attr("href", n.image)
          .attr("width", NODE_RADIUS * 2)
          .attr("height", NODE_RADIUS * 2)
          .attr("preserveAspectRatio", "xMidYMid slice");
      });

      // ---------- 6. Adjacency + connection counts ----------
      const neighbors = new Map<string, Set<string>>();
      const connectionCount: Record<string, number> = {};
      links.forEach((l) => {
        const s = l.sourceId;
        const t = l.targetId;
        if (!neighbors.has(s)) neighbors.set(s, new Set());
        if (!neighbors.has(t)) neighbors.set(t, new Set());
        neighbors.get(s)!.add(t);
        neighbors.get(t)!.add(s);

        connectionCount[s] = (connectionCount[s] || 0) + 1;
        connectionCount[t] = (connectionCount[t] || 0) + 1;
      });

      // ---------- 7. Links (main + minimap) ----------
      const linkSel = mainG
        .append("g")
        .attr("stroke-linecap", "round")
        .selectAll("line")
        .data(links)
        .enter()
        .append("line")
        .attr("stroke-width", LINE_WIDTH)
        .attr("stroke", (d) => genreColor[d.genre] ?? GENRE_FALLBACK_COLOR)
        .attr("stroke-opacity", 0.7);

      const miniLinks = minimapG
        .append("g")
        .selectAll("line")
        .data(links)
        .enter()
        .append("line")
        .attr("stroke-width", 1)
        .attr("stroke", (d) => genreColor[d.genre] ?? "#555")
        .attr("stroke-opacity", 0.7);

      // ---------- 8. Nodes (main + minimap) ----------
      const nodeSel = mainG
        .append("g")
        .selectAll("circle")
        .data(nodes)
        .enter()
        .append("circle")
        .attr("r", NODE_RADIUS)
        .attr("fill", (d) =>
          d.image ? `url(#img-${d.id})` : "#444444"
        )
        .attr("stroke", (d) => {
          const g = (d.genre[0] ?? "unknown").toLowerCase();
          return genreColor[g] ?? "#ffffff";
        })
        .attr("stroke-width", 2)
        .style("cursor", "pointer");

      const miniNodes = minimapG
        .append("g")
        .selectAll("circle")
        .data(nodes)
        .enter()
        .append("circle")
        .attr("r", NODE_RADIUS * scaleX * 0.9)
        .attr("fill", "#777")
        .attr("stroke", "#111")
        .attr("stroke-width", 1);

      // ---------- 9. Hover animation ----------
      function highlightHover(d: ArtistRecord | null) {
        if (!d) {
          nodeSel
            .transition()
            .duration(150)
            .attr("r", NODE_RADIUS)
            .attr("opacity", 1)
            .attr("stroke-width", 2);

          linkSel
            .transition()
            .duration(150)
            .attr("stroke-opacity", 0.7);
          return;
        }

        const neigh = neighbors.get(d.id) ?? new Set<string>();

        nodeSel
          .transition()
          .duration(150)
          .attr("r", (n) =>
            n.id === d.id || neigh.has(n.id)
              ? NODE_RADIUS * 1.3
              : NODE_RADIUS * 0.9
          )
          .attr("opacity", (n) =>
            n.id === d.id || neigh.has(n.id) ? 1 : 0.3
          )
          .attr("stroke-width", (n) =>
            n.id === d.id ? 3 : 2
          );

        linkSel
          .transition()
          .duration(150)
          .attr("stroke-opacity", (l) =>
            l.sourceId === d.id || l.targetId === d.id ? 1 : 0.2
          );
      }

      nodeSel
        .on("mouseover", function (event, d) {
          highlightHover(d);
          tooltip
            .style("opacity", 1)
            .html(
              `<strong>${d.name.toUpperCase()}</strong><br/>
               GENRES: ${d.genre.join(", ").toUpperCase()}<br/>
               CONNECTIONS: ${(connectionCount[d.id] || 0)
                 .toString()
                 .toUpperCase()}`
            )
            .style("left", event.pageX + 14 + "px")
            .style("top", event.pageY + 14 + "px");
        })
        .on("mousemove", function (event) {
          tooltip
            .style("left", event.pageX + 14 + "px")
            .style("top", event.pageY + 14 + "px");
        })
        .on("mouseout", function () {
          tooltip.style("opacity", 0);
          highlightHover(null);
        });

      // ---------- 10. Minimap viewport rectangle ----------
      const viewportRect = minimapSvg
        .append("rect")
        .attr("fill", "none")
        .attr("stroke", "white")
        .attr("stroke-width", 1)
        .attr("pointer-events", "none");

      let currentTransform = d3.zoomIdentity;

      function updateMinimapViewport() {
        const k = currentTransform.k;
        const tx = currentTransform.x;
        const ty = currentTransform.y;

        const x0 = -tx / k;
        const x1 = (width - tx) / k;
        const y0 = -ty / k;
        const y1 = (height - ty) / k;

        viewportRect
          .attr("x", x0 * scaleX)
          .attr("y", y0 * scaleY)
          .attr("width", (x1 - x0) * scaleX)
          .attr("height", (y1 - y0) * scaleY);
      }

      // click minimap to re-center
      minimapSvg.on("click", (event) => {
        const [mx, my] = d3.pointer(event);
        const targetX = mx / scaleX;
        const targetY = my / scaleY;

        const k = currentTransform.k;
        const newTransform = d3.zoomIdentity
          .translate(width / 2 - targetX * k, height / 2 - targetY * k)
          .scale(k);

        svg
          .transition()
          .duration(400)
          .call(zoomBehavior.transform as any, newTransform);
      });

      // ---------- 11. Zoom + pan ----------
      const zoomBehavior = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 5])
        .on("zoom", (event) => {
          currentTransform = event.transform;
          mainG.attr("transform", currentTransform.toString());
          updateMinimapViewport();
        });

      svg.call(zoomBehavior as any);
      updateMinimapViewport();

      // ---------- 12. Force simulation with genre clustering ----------
      const simulation = d3
        .forceSimulation<ArtistRecord>(nodes)
        .force(
          "link",
          d3
            .forceLink<ArtistRecord, Link>(links)
            .id((d) => d.id)
            .distance(130)
        )
        .force(
          "charge",
          d3.forceManyBody<ArtistRecord>().strength(-220)
        )
        .force(
          "x",
          d3.forceX<ArtistRecord>((d) => {
            const g = (d.genre[0] ?? "unknown").toLowerCase();
            return genreCenterX[g] ?? width / 2;
          }).strength(0.25)
        )
        .force(
          "y",
          d3.forceY<ArtistRecord>(height / 2).strength(0.06)
        )
        .force(
          "collision",
          d3.forceCollide<ArtistRecord>().radius(NODE_RADIUS * 2.2)
        )
        .on("tick", () => {
          linkSel
            .attr("x1", (d) =>
              typeof d.source !== "string"
                ? d.source.x ?? 0
                : 0
            )
            .attr("y1", (d) =>
              typeof d.source !== "string"
                ? d.source.y ?? 0
                : 0
            )
            .attr("x2", (d) =>
              typeof d.target !== "string"
                ? d.target.x ?? 0
                : 0
            )
            .attr("y2", (d) =>
              typeof d.target !== "string"
                ? d.target.y ?? 0
                : 0
            );

          nodeSel
            .attr("cx", (d) => d.x ?? 0)
            .attr("cy", (d) => d.y ?? 0);

          miniLinks
            .attr("x1", (d) =>
              typeof d.source !== "string"
                ? (d.source.x ?? 0) * scaleX
                : 0
            )
            .attr("y1", (d) =>
              typeof d.source !== "string"
                ? (d.source.y ?? 0) * scaleY
                : 0
            )
            .attr("x2", (d) =>
              typeof d.target !== "string"
                ? (d.target.x ?? 0) * scaleX
                : 0
            )
            .attr("y2", (d) =>
              typeof d.target !== "string"
                ? (d.target.y ?? 0) * scaleY
                : 0
            );

          miniNodes
            .attr("cx", (d) => (d.x ?? 0) * scaleX)
            .attr("cy", (d) => (d.y ?? 0) * scaleY);
        });

      // ---------- 13. Cleanup ----------
      return () => {
        tooltip.remove();
        simulation.stop();
        svg.on(".zoom", null);
        minimapSvg.on(".click", null);
      };
    }

    run();
  }, []);

  /* ------- React legend (simple) -------- */
  // (Legend colours won’t be perfect until after data loads,
  //  but it’s good enough and doesn’t affect the graph.)

  return (
    <div>
      <svg ref={svgRef} />
      <svg
        ref={minimapRef}
        style={{
          position: "fixed",
          left: 16,
          top: 16,
          borderRadius: 8,
          overflow: "hidden",
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          padding: 12,
          background: "rgba(0,0,0,0.75)",
          borderRadius: 8,
          color: "#ffffff",
          fontFamily: "Afacad, sans-serif",
          fontSize: 12,
        }}
      >
        <strong>GENRES</strong>
        <div style={{ marginTop: 6 }}>
          {/* The legend uses a simple placeholder; you can refine if needed */}
          <div>COLOURS FOLLOW PRIMARY GENRES</div>
        </div>
      </div>
    </div>
  );
}
